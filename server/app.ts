import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { toCsv } from '../shared/csv';
import { termStats, crowding, CROWDING_FORMULA } from '../shared/keywords';
import { addDays } from '../shared/ranks';
import { adLibraryLinks, isSafeExternalUrl, parseStoreRef, storeListingUrl, storeSearchUrl } from '../shared/storeUrls';
import { ROOT, type AppConfig } from './config';
import { all, get, getSetting, migrate, nowIso, openDb, run, todayUtc, type Db } from './db';
import { PoliteClient, ProviderError, type Transport } from './http/client';
import { runIngestion } from './ingest/run';
import { commitImport, FIRST_PARTY_PRESETS, IMPORT_KINDS, parseImport } from './io/imports';
import { buildPublicDataset, compareData, researchBrief } from './io/exports';
import { backupDb } from './lib/backup';
import { lookupApple, searchApple } from './providers/apple';
import { fetchPlayDetails } from './providers/googlePlay';
import { PROVIDERS } from './providers/manifest';
import { MalformedPayloadError } from './providers/types';
import { catalog, chartView, coverage, listingProfile, listScopes, moversView, newToChartView, parseScopeId, publisherProfile } from './repo/query';
import { createManualLink, setLinkStatus, suggestLinks } from './repo/links';
import { storeListingObservation, upsertListing } from './repo/store';

export interface AppOptions {
  config: AppConfig;
  db?: Db;
  transport?: Transport;
  serveStatic?: boolean;
  logger?: boolean;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const market = z.string().regex(/^[a-z]{2}$/);
const optStr = (max: number) => z.string().max(max).optional().nullable().transform((v) => (v === '' ? null : (v ?? null)));
const optUrl = z
  .string()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isSafeExternalUrl(v), 'must be an http(s) URL');

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  return r.data;
}

export async function buildApp(opts: AppOptions): Promise<{ app: FastifyInstance; db: Db }> {
  const cfg = opts.config;
  const db = opts.db ?? openDb(cfg.dbPath);
  migrate(db);
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: cfg.importMaxBytes + 100_000, trustProxy: false });
  let ingestRunning: Promise<unknown> | null = null;

  // ---- Local-only guard: DNS-rebinding protection + cross-origin write protection ----
  const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  app.addHook('onRequest', async (req, reply) => {
    const host = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    if (host && !allowedHosts.has(host) && cfg.host === '127.0.0.1') return reply.code(421).send({ error: 'Host not allowed' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.url.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (origin) {
        let ok: boolean;
        try {
          ok = allowedHosts.has(new URL(origin).hostname.toLowerCase());
        } catch {
          ok = false;
        }
        if (!ok) return reply.code(403).send({ error: 'Cross-origin write rejected' });
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'Cross-site write rejected' });
      // Custom header forces a CORS preflight for browsers, which this server never approves.
      if (req.headers['x-radar-request'] !== '1') return reply.code(403).send({ error: 'Missing X-Radar-Request header' });
    }
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    return payload;
  });
  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err?.statusCode === 413) return reply.code(413).send({ error: `Upload too large (max ${cfg.importMaxBytes} bytes)` });
    if (err?.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    if (err instanceof ProviderError) return reply.code(502).send({ error: err.message, errorClass: err.errorClass });
    if (err instanceof MalformedPayloadError) return reply.code(502).send({ error: err.message, errorClass: 'malformed' });
    app.log.error(err);
    return reply.code(500).send({ error: 'Internal error' });
  });

  const liveOnly = () => {
    if (cfg.mode === 'demo') throw new HttpError(409, 'Live source requests are disabled in demo mode. Demo data is fictional and kept in a separate database.');
  };
  const client = (provider: string, kind: 'apple' | 'google') =>
    new PoliteClient(
      { provider, budget: 5, minIntervalMs: kind === 'apple' ? 500 : 2000, timeoutMs: cfg.httpTimeoutMs, maxRetries: 1, maxConcurrency: 1, cacheTtlMin: cfg.cacheTtlMin, acceptLanguage: 'en-US,en;q=0.8' },
      db,
      () => {},
      opts.transport,
    );
  const scopeQ = (s: unknown) => {
    const sc = parseScopeId(String(s ?? ''));
    if (!sc) throw new HttpError(400, 'Invalid scope');
    return sc;
  };

  // ---------------- meta ----------------
  app.get('/api/meta', async () => ({
    mode: cfg.mode,
    publicMode: false,
    version: '0.1.0',
    today: todayUtc(),
    markets: all(db, 'SELECT * FROM markets ORDER BY enabled DESC, code'),
    unified: all(db, 'SELECT slug, name, is_game FROM unified_categories ORDER BY is_game, name'),
    providers: PROVIDERS.map((p) => ({ ...p, validation: getSetting(db, `validation:${p.id}`, null) })),
    config: {
      ingestMarkets: cfg.ingestMarkets, chartDepth: cfg.chartDepth, appleCharts: cfg.appleCharts, budgets: cfg.budgets, googlePlayEnabled: cfg.googlePlayEnabled,
      alertRankThreshold: cfg.alertRankThreshold, importMaxBytes: cfg.importMaxBytes, cacheTtlMin: cfg.cacheTtlMin, host: cfg.host, port: cfg.port,
    },
    ingestRunning: !!ingestRunning,
  }));

  // ---------------- discover ----------------
  app.get('/api/scopes', async () => listScopes(db));
  app.get('/api/charts', async (req) => {
    const q = req.query as any;
    return chartView(db, scopeQ(q.scope), {
      day: q.day && day.safeParse(q.day).success ? q.day : undefined,
      unified: q.unified ? String(q.unified).slice(0, 40) : undefined,
      priceType: q.priceType === 'free' || q.priceType === 'paid' ? q.priceType : undefined,
      releasedAfter: q.releasedAfter && day.safeParse(q.releasedAfter).success ? q.releasedAfter : undefined,
      releasedBefore: q.releasedBefore && day.safeParse(q.releasedBefore).success ? q.releasedBefore : undefined,
    });
  });
  app.get('/api/movers', async (req) => {
    const q = req.query as any;
    const w = Number(q.window) === 30 ? 30 : Number(q.window) === 1 ? 1 : 7;
    return moversView(db, scopeQ(q.scope), w as 1 | 7 | 30);
  });
  app.get('/api/new-to-chart', async (req) => newToChartView(db, scopeQ((req.query as any).scope)));
  app.get('/api/catalog', async (req) => {
    const q = req.query as any;
    return catalog(db, {
      q: q.q ? String(q.q) : undefined, platform: q.platform, market: q.market, unified: q.unified ? String(q.unified).slice(0, 40) : undefined,
      kind: q.kind === 'apps' || q.kind === 'games' ? q.kind : undefined, priceType: q.priceType === 'free' || q.priceType === 'paid' ? q.priceType : undefined,
      releasedAfter: q.releasedAfter && day.safeParse(q.releasedAfter).success ? q.releasedAfter : undefined,
      releasedBefore: q.releasedBefore && day.safeParse(q.releasedBefore).success ? q.releasedBefore : undefined,
      tracked: q.tracked === '1', sort: q.sort, dir: q.dir === 'asc' ? 'asc' : 'desc', page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 50,
    });
  });

  // ---------------- profiles ----------------
  app.get('/api/listings/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const q = req.query as any;
    const p = listingProfile(db, id, { includePrivate: true, from: day.safeParse(q.from).success ? q.from : undefined, to: day.safeParse(q.to).success ? q.to : undefined });
    if (!p) throw new HttpError(404, 'Listing not found');
    const l = p.listing;
    const markets = all<any>(db, 'SELECT code FROM markets WHERE enabled = 1').map((m) => m.code);
    p.links = {
      store: markets.map((m) => ({ market: m, url: storeListingUrl(l.platform, l.store_id, m) })),
      search: markets.map((m) => ({ market: m, url: storeSearchUrl(l.platform, l.title, m) })),
      adLibraries: adLibraryLinks(l.publisher_name ?? l.title, markets[0] ?? 'us'),
    };
    return p;
  });
  app.get('/api/publishers/:id', async (req) => {
    const p = publisherProfile(db, parse(idParam, req.params).id);
    if (!p) throw new HttpError(404, 'Publisher not found');
    return p;
  });

  // ---------------- lookup / registration ----------------
  app.post('/api/lookup', async (req) => {
    const b = parse(z.object({ input: z.string().min(1).max(2048), market: market, fetch: z.boolean().optional() }), req.body);
    const ref = parseStoreRef(b.input);
    if (!ref) throw new HttpError(400, 'Not a supported store URL or id. Use an apps.apple.com URL, an Apple numeric id, a play.google.com/store/apps/details URL, or an Android package name.');
    const fallback = { playSearch: ref.platform === 'android' ? storeSearchUrl('android', ref.storeId, b.market) : null, storeUrl: storeListingUrl(ref.platform, ref.storeId, b.market) };
    const note = ref.urlCountry && ref.urlCountry !== b.market ? `The URL points to the ${ref.urlCountry.toUpperCase()} storefront; data below is for the selected market ${b.market.toUpperCase()}.` : null;
    const shouldFetch = b.fetch !== false && cfg.mode === 'live';
    if (ref.platform === 'ios') {
      if (!shouldFetch) {
        const id = upsertListing(db, { platform: 'ios', storeId: ref.storeId, title: ref.storeId, provenance: cfg.mode === 'demo' ? 'demo' : 'user', tracked: true });
        return { listingId: id, status: 'registered_without_fetch', note, fallback };
      }
      const [n] = await lookupApple(client('itunes-lookup', 'apple'), [ref.storeId], b.market);
      const id = storeListingObservation(db, n, { provider: 'itunes-lookup', provenance: 'observed', snapshotDay: todayUtc(), tracked: true });
      return { listingId: id, status: n.availability === 'available' ? 'fetched' : 'unavailable_in_market', note, fallback };
    }
    // Android: register first so history/compare/export work regardless of the reader.
    const existing = get<any>(db, "SELECT id FROM listings WHERE platform='android' AND store_id = ?", [ref.storeId]);
    const id = existing?.id ?? upsertListing(db, { platform: 'android', storeId: ref.storeId, title: ref.storeId, provenance: cfg.mode === 'demo' ? 'demo' : 'user', tracked: true });
    run(db, 'UPDATE listings SET tracked = 1 WHERE id = ?', [id]);
    if (!shouldFetch || !cfg.googlePlayEnabled) {
      return { listingId: id, status: 'registered_without_fetch', reason: !cfg.googlePlayEnabled ? 'Google Play reader disabled by configuration' : 'demo mode', note, fallback };
    }
    try {
      const n = await fetchPlayDetails(client('google-play-details', 'google'), ref.storeId, b.market, 'en');
      storeListingObservation(db, n, { provider: 'google-play-details', provenance: 'observed', snapshotDay: todayUtc(), tracked: true });
      return { listingId: id, status: n.availability === 'available' ? 'fetched' : 'unavailable_in_market', note, fallback };
    } catch (e: any) {
      return { listingId: id, status: 'registered_fetch_failed', errorClass: e?.errorClass ?? (e instanceof MalformedPayloadError ? 'malformed' : 'network'), reason: String(e?.message ?? e).slice(0, 300), note, fallback };
    }
  });
  app.post('/api/search/apple', async (req) => {
    liveOnly();
    const b = parse(z.object({ term: z.string().min(1).max(100), market }), req.body);
    const rows = await searchApple(client('itunes-lookup', 'apple'), b.term, b.market, 25);
    return { market: b.market, note: 'iTunes Search API order — not App Store search ranking. Nothing is stored until you track a result.', rows };
  });
  app.post('/api/listings/:id/track', async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ tracked: z.boolean() }), req.body);
    run(db, 'UPDATE listings SET tracked = ? WHERE id = ?', [b.tracked ? 1 : 0, id]);
    return { ok: true };
  });
  app.post('/api/listings/:id/observations', async (req) => {
    const { id } = parse(idParam, req.params);
    const l = get<any>(db, 'SELECT * FROM listings WHERE id = ?', [id]);
    if (!l) throw new HttpError(404, 'Listing not found');
    const b = parse(
      z.object({
        market, observedDay: day, title: optStr(300), publisher: optStr(300), price: z.number().min(0).nullable().optional(), currency: optStr(3),
        rating: z.number().min(0).max(5).nullable().optional(), ratingCount: z.number().int().min(0).nullable().optional(), installBand: optStr(20),
        version: optStr(60), updatedAt: day.nullable().optional(), hasAds: z.boolean().nullable().optional(), hasIap: z.boolean().nullable().optional(),
        sourceUrl: optUrl, categoryId: optStr(60),
      }),
      req.body,
    );
    const { installLowerBound } = await import('./providers/googlePlay');
    storeListingObservation(
      db,
      {
        platform: l.platform, storeId: l.store_id, market: b.market, language: null, availability: 'available', title: b.title ?? l.title, description: null,
        publisherName: b.publisher ?? null, publisherStoreId: null, publisherUrl: null, categoryId: b.categoryId ?? null, categoryName: null, isGame: null,
        price: b.price ?? null, currency: b.currency ?? null, rating: b.rating ?? null, ratingCount: b.ratingCount ?? null, ratingScope: b.rating != null ? 'user-supplied' : null,
        version: b.version ?? null, storeUpdatedAt: b.updatedAt ?? null, releaseDate: null, iconUrl: null, installBand: b.installBand ?? null,
        installLowerBound: installLowerBound(b.installBand ?? null), hasAds: b.hasAds ?? null, hasIap: b.hasIap ?? null, contentRating: null, sourceUrl: b.sourceUrl ?? 'manual',
      },
      { provider: 'manual', provenance: cfg.mode === 'demo' ? 'demo' : 'user', snapshotDay: b.observedDay, observedAt: nowIso() },
    );
    return { ok: true };
  });
  app.post('/api/listings/:id/notes', async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ body: z.string().min(1).max(10000), tags: optStr(300) }), req.body);
    run(db, 'INSERT INTO private_notes (listing_id, body, tags, created_at) VALUES (?, ?, ?, ?)', [id, b.body, b.tags ?? null, nowIso()]);
    return { ok: true };
  });
  app.delete('/api/notes/:id', async (req) => {
    run(db, 'DELETE FROM private_notes WHERE id = ?', [parse(idParam, req.params).id]);
    return { ok: true };
  });

  // ---------------- cross-store links ----------------
  app.post('/api/links/suggest', async () => suggestLinks(db));
  app.get('/api/links', async (req) => {
    const st = (req.query as any).status;
    return all(
      db,
      `SELECT k.*, a.title AS a_title, a.platform AS a_platform, a.store_id AS a_store_id, b.title AS b_title, b.platform AS b_platform, b.store_id AS b_store_id
       FROM listing_links k JOIN listings a ON a.id = k.listing_a JOIN listings b ON b.id = k.listing_b ${st ? 'WHERE k.status = ?' : ''} ORDER BY k.created_at DESC LIMIT 500`,
      st ? [String(st)] : [],
    ).map((r: any) => ({ ...r, evidence: JSON.parse(r.evidence_json) }));
  });
  app.post('/api/links/:id', async (req) => {
    const b = parse(z.object({ status: z.enum(['verified', 'rejected']) }), req.body);
    if (!setLinkStatus(db, parse(idParam, req.params).id, b.status)) throw new HttpError(404, 'Link not found');
    return { ok: true };
  });
  app.post('/api/links', async (req) => {
    const b = parse(z.object({ a: z.number().int().positive(), b: z.number().int().positive(), note: z.string().max(500).default('') }), req.body);
    try {
      createManualLink(db, b.a, b.b, b.note);
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
    return { ok: true };
  });

  // ---------------- watchlists & alerts ----------------
  app.get('/api/watchlists', async () => {
    const lists = all<any>(db, 'SELECT w.*, (SELECT COUNT(*) FROM watchlist_items i WHERE i.watchlist_id = w.id) AS count FROM watchlists w ORDER BY w.name');
    for (const w of lists)
      w.items = all(db, `SELECT i.*, l.title, l.platform, l.store_id, l.icon_url, p.name AS publisher_name FROM watchlist_items i JOIN listings l ON l.id = i.listing_id LEFT JOIN publishers p ON p.id = l.publisher_id WHERE i.watchlist_id = ? ORDER BY l.title`, [w.id]);
    return lists;
  });
  const wlBody = z.object({ name: z.string().min(1).max(100), notes: optStr(2000), tags: optStr(300) });
  app.post('/api/watchlists', async (req) => {
    const b = parse(wlBody, req.body);
    try {
      const r = run(db, 'INSERT INTO watchlists (name, notes, tags, created_at) VALUES (?, ?, ?, ?)', [b.name, b.notes ?? null, b.tags ?? null, nowIso()]);
      return { id: Number(r.lastInsertRowid) };
    } catch {
      throw new HttpError(409, 'A watchlist with that name exists');
    }
  });
  app.patch('/api/watchlists/:id', async (req) => {
    const b = parse(wlBody.partial(), req.body);
    const id = parse(idParam, req.params).id;
    run(db, 'UPDATE watchlists SET name = COALESCE(?, name), notes = COALESCE(?, notes), tags = COALESCE(?, tags) WHERE id = ?', [b.name ?? null, b.notes ?? null, b.tags ?? null, id]);
    return { ok: true };
  });
  app.delete('/api/watchlists/:id', async (req) => {
    run(db, 'DELETE FROM watchlists WHERE id = ?', [parse(idParam, req.params).id]);
    return { ok: true };
  });
  app.post('/api/watchlists/:id/items', async (req) => {
    const id = parse(idParam, req.params).id;
    const b = parse(z.object({ listingId: z.number().int().positive(), notes: optStr(2000), tags: optStr(300) }), req.body);
    if (!get(db, 'SELECT 1 FROM listings WHERE id = ?', [b.listingId])) throw new HttpError(404, 'Listing not found');
    run(db, 'INSERT INTO watchlist_items (watchlist_id, listing_id, notes, tags, added_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET notes = excluded.notes, tags = excluded.tags', [
      id, b.listingId, b.notes ?? null, b.tags ?? null, nowIso(),
    ]);
    run(db, 'UPDATE listings SET tracked = 1 WHERE id = ?', [b.listingId]);
    return { ok: true };
  });
  app.delete('/api/watchlists/:id/items/:listingId', async (req) => {
    const p = parse(z.object({ id: z.coerce.number().int(), listingId: z.coerce.number().int() }), req.params);
    run(db, 'DELETE FROM watchlist_items WHERE watchlist_id = ? AND listing_id = ?', [p.id, p.listingId]);
    return { ok: true };
  });
  app.get('/api/alerts', async (req) => {
    const unread = (req.query as any).unread === '1';
    return all<any>(db, `SELECT a.*, l.title, l.platform FROM alerts a LEFT JOIN listings l ON l.id = a.listing_id ${unread ? 'WHERE a.read_at IS NULL' : ''} ORDER BY a.created_at DESC, a.id DESC LIMIT 500`).map((a) => ({
      ...a,
      evidence: JSON.parse(a.evidence_json),
    }));
  });
  app.post('/api/alerts/:id/read', async (req) => {
    run(db, 'UPDATE alerts SET read_at = ? WHERE id = ?', [nowIso(), parse(idParam, req.params).id]);
    return { ok: true };
  });
  app.post('/api/alerts/read-all', async () => {
    run(db, 'UPDATE alerts SET read_at = ? WHERE read_at IS NULL', [nowIso()]);
    return { ok: true };
  });
  app.post('/api/alerts/generate', async () => {
    const { generateAlerts } = await import('./ingest/alerts');
    return { created: generateAlerts(db, cfg.alertRankThreshold, null) };
  });

  // ---------------- evidence & teardowns ----------------
  const evBody = z.object({
    kind: z.enum(['paid_ad', 'organic_post', 'sponsorship_unverified', 'creator', 'screenshot', 'store_page', 'other']),
    listingId: z.number().int().positive().nullable().optional(), publisherId: z.number().int().positive().nullable().optional(),
    channel: optStr(60), market: market.nullable().optional(), advertiser: optStr(200), creator: optStr(200), hook: optStr(500), format: optStr(60),
    url: optUrl, searchUrl: optUrl, localPath: optStr(500), firstObserved: day.nullable().optional(), lastObserved: day.nullable().optional(),
    metrics: z.array(z.object({ label: z.string().min(1).max(100), value: z.string().max(100), scope: z.string().max(200).optional().default('') })).max(20).default([]),
    tags: optStr(300), notes: optStr(4000), isPublic: z.boolean().default(false),
  });
  app.get('/api/evidence', async (req) => {
    const q = req.query as any;
    const where: string[] = [];
    const params: any[] = [];
    if (q.q) {
      const like = '%' + String(q.q).slice(0, 100).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      where.push("(e.hook LIKE ? ESCAPE '\\' OR e.advertiser LIKE ? ESCAPE '\\' OR e.creator LIKE ? ESCAPE '\\' OR e.notes LIKE ? ESCAPE '\\' OR e.tags LIKE ? ESCAPE '\\' OR l.title LIKE ? ESCAPE '\\')");
      params.push(like, like, like, like, like, like);
    }
    if (q.kind) {
      where.push('e.kind = ?');
      params.push(String(q.kind));
    }
    if (q.channel) {
      where.push('e.channel = ?');
      params.push(String(q.channel));
    }
    if (q.market) {
      where.push('e.market = ?');
      params.push(String(q.market));
    }
    if (q.listingId) {
      where.push('e.listing_id = ?');
      params.push(Number(q.listingId));
    }
    if (q.tag) {
      where.push("(',' || REPLACE(IFNULL(e.tags,''), ' ', '') || ',') LIKE ?");
      params.push(`%,${String(q.tag).replace(/[%_\s]/g, '')},%`);
    }
    if (q.from && day.safeParse(q.from).success) {
      where.push('COALESCE(e.first_observed, substr(e.created_at,1,10)) >= ?');
      params.push(q.from);
    }
    if (q.to && day.safeParse(q.to).success) {
      where.push('COALESCE(e.first_observed, substr(e.created_at,1,10)) <= ?');
      params.push(q.to);
    }
    return all<any>(
      db,
      `SELECT e.*, l.title AS listing_title, l.platform AS listing_platform, p.name AS publisher_name FROM evidence e LEFT JOIN listings l ON l.id = e.listing_id LEFT JOIN publishers p ON p.id = COALESCE(e.publisher_id, l.publisher_id)
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(e.first_observed, e.created_at) DESC LIMIT 1000`,
      params,
    ).map((e) => ({ ...e, metrics: JSON.parse(e.metrics_json) }));
  });
  app.post('/api/evidence', async (req) => {
    const b = parse(evBody, req.body);
    const r = run(
      db,
      `INSERT INTO evidence (kind, listing_id, publisher_id, channel, market, advertiser, creator, hook, format, url, search_url, local_path, first_observed, last_observed, metrics_json, tags, notes, is_public, provenance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.kind, b.listingId ?? null, b.publisherId ?? null, b.channel, b.market ?? null, b.advertiser, b.creator, b.hook, b.format, b.url, b.searchUrl, b.localPath, b.firstObserved ?? null, b.lastObserved ?? null,
        JSON.stringify(b.metrics), b.tags, b.notes, b.isPublic ? 1 : 0, cfg.mode === 'demo' ? 'demo' : 'user', nowIso()],
    );
    return { id: Number(r.lastInsertRowid) };
  });
  app.delete('/api/evidence/:id', async (req) => {
    run(db, 'DELETE FROM evidence WHERE id = ?', [parse(idParam, req.params).id]);
    return { ok: true };
  });
  const tdBody = z.object({
    listingId: z.number().int().positive(), versionLabel: optStr(60), observedAt: day, market: market.nullable().optional(), device: optStr(60),
    firstMeaningfulAction: optStr(500), stepsToValue: z.number().int().min(0).max(1000).nullable().optional(), signupFriction: optStr(500), paywallTiming: optStr(300),
    permissions: optStr(500), pricing: optStr(500), trialTerms: optStr(300), evidenceUrl: optUrl, localPath: optStr(500), notes: optStr(4000),
  });
  app.get('/api/teardowns', async (req) => {
    const lid = Number((req.query as any).listingId);
    return all(db, `SELECT t.*, l.title, l.platform FROM onboarding_teardowns t JOIN listings l ON l.id = t.listing_id ${lid ? 'WHERE t.listing_id = ?' : ''} ORDER BY t.observed_at DESC LIMIT 500`, lid ? [lid] : []);
  });
  app.post('/api/teardowns', async (req) => {
    const b = parse(tdBody, req.body);
    const r = run(
      db,
      `INSERT INTO onboarding_teardowns (listing_id, version_label, observed_at, market, device, first_meaningful_action, steps_to_value, signup_friction, paywall_timing, permissions, pricing, trial_terms, evidence_url, local_path, notes, provenance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.listingId, b.versionLabel, b.observedAt, b.market ?? null, b.device, b.firstMeaningfulAction, b.stepsToValue ?? null, b.signupFriction, b.paywallTiming, b.permissions, b.pricing, b.trialTerms, b.evidenceUrl, b.localPath, b.notes, cfg.mode === 'demo' ? 'demo' : 'user', nowIso()],
    );
    return { id: Number(r.lastInsertRowid) };
  });
  app.delete('/api/teardowns/:id', async (req) => {
    run(db, 'DELETE FROM onboarding_teardowns WHERE id = ?', [parse(idParam, req.params).id]);
    return { ok: true };
  });

  // ---------------- keyword lab ----------------
  app.post('/api/keywords/lab', async (req) => {
    const b = parse(z.object({ ids: z.array(z.number().int().positive()).max(500).default([]), watchlistId: z.number().int().positive().optional(), market: market.optional(), maxN: z.number().int().min(1).max(3).default(3) }), req.body);
    let ids = b.ids;
    if (b.watchlistId) ids = [...ids, ...all<any>(db, 'SELECT listing_id FROM watchlist_items WHERE watchlist_id = ?', [b.watchlistId]).map((r) => r.listing_id)];
    ids = [...new Set(ids)];
    const docs = ids
      .map((id) => {
        const l = get<any>(db, 'SELECT id, title FROM listings WHERE id = ?', [id]);
        if (!l) return null;
        const o = get<any>(db, `SELECT title, subtitle, description FROM listing_observations WHERE listing_id = ? ${b.market ? 'AND market = ?' : ''} AND availability='available' ORDER BY snapshot_day DESC LIMIT 1`, b.market ? [id, b.market] : [id]);
        return { id: l.id, title: o?.title ?? l.title, text: [o?.subtitle, o?.description].filter(Boolean).join(' ') };
      })
      .filter(Boolean) as { id: number; title: string; text: string }[];
    const withText = docs.filter((d) => d.text).length;
    const stats = termStats(docs, { maxN: b.maxN, minDocFreq: 2, limit: 300 }).map((s) => ({ ...s, crowding: crowding(s) }));
    return {
      sampleSize: docs.length,
      sampleWithDescriptions: withText,
      market: b.market ?? null,
      note: 'Frequencies are within this tracked sample only — not store-wide. Search volume and difficulty are unavailable from the sources used.',
      crowdingFormula: CROWDING_FORMULA,
      terms: stats,
    };
  });
  app.get('/api/keywords', async () =>
    all<any>(db, 'SELECT * FROM keywords ORDER BY group_name, phrase').map((k) => ({
      ...k,
      observations: all(db, 'SELECT o.*, l.title FROM keyword_observations o LEFT JOIN listings l ON l.id = o.listing_id WHERE o.keyword_id = ? ORDER BY o.observed_day DESC LIMIT 50', [k.id]),
    })),
  );
  app.post('/api/keywords', async (req) => {
    const b = parse(z.object({ phrases: z.array(z.string().min(1).max(200)).min(1).max(500), group: optStr(100), platform: z.enum(['ios', 'android']).nullable().optional(), market: market.nullable().optional(), notes: optStr(1000) }), req.body);
    let n = 0;
    for (const p of b.phrases) n += Number(run(db, 'INSERT OR IGNORE INTO keywords (phrase, group_name, platform, market, notes, provenance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [p.trim().toLowerCase(), b.group, b.platform ?? null, b.market ?? null, b.notes, 'user', nowIso()]).changes);
    return { added: n };
  });
  app.delete('/api/keywords/:id', async (req) => {
    run(db, 'DELETE FROM keywords WHERE id = ?', [parse(idParam, req.params).id]);
    return { ok: true };
  });

  // ---------------- imports ----------------
  app.get('/api/imports/kinds', async () => ({ kinds: IMPORT_KINDS, presets: FIRST_PARTY_PRESETS, maxBytes: cfg.importMaxBytes }));
  app.get('/api/imports', async () => all(db, 'SELECT * FROM imports ORDER BY id DESC LIMIT 200'));
  const impBody = z.object({
    kind: z.string().max(40), format: z.enum(['csv', 'json']), content: z.string().max(cfg.importMaxBytes), filename: optStr(200), sourceLabel: optStr(200),
    preset: z.string().max(60).optional(), platform: z.enum(['ios', 'android']).optional(), storeId: z.string().max(255).optional(),
  });
  app.post('/api/imports/preview', async (req) => {
    const b = parse(impBody, req.body);
    try {
      const p = parseImport(db, b);
      return { ...p, rows: p.rows.slice(0, 200), previewTruncated: p.rows.length > 200 };
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
  });
  app.post('/api/imports/commit', async (req) => {
    const b = parse(impBody, req.body);
    let p;
    try {
      p = parseImport(db, b);
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
    if (p.missingColumns.length) throw new HttpError(400, `Missing required columns: ${p.missingColumns.join(', ')}`);
    return commitImport(db, p, { filename: b.filename, sourceLabel: b.sourceLabel });
  });
  app.delete('/api/imports/:id', async (req) => {
    run(db, 'DELETE FROM imports WHERE id = ?', [parse(idParam, req.params).id]);
    return { ok: true };
  });

  // ---------------- compare, export, brief ----------------
  const cmpBody = z.object({ ids: z.array(z.number().int().positive()).min(1).max(5), from: day, to: day, scopeIds: z.array(z.string().max(300)).max(50).optional(), market: market.optional() });
  app.post('/api/compare', async (req) => compareData(db, parse(cmpBody, req.body)));
  app.post('/api/compare/export', async (req, reply) => {
    const b = parse(cmpBody.extend({ format: z.enum(['csv', 'json']), table: z.enum(['ranks', 'observations']).default('ranks') }), req.body);
    const data = compareData(db, b);
    const stamp = new Date().toISOString().slice(0, 10);
    if (b.format === 'json') {
      reply.header('Content-Disposition', `attachment; filename="compare-${stamp}.json"`);
      return { ...data, listings: data.listings.map((l: any) => ({ ...l, notes: undefined })) };
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="compare-${b.table}-${stamp}.csv"`);
    return toCsv(b.table === 'ranks' ? data.rankRows : data.obsRows);
  });
  app.post('/api/brief', async (req) =>
    researchBrief(db, parse(z.object({ ids: z.array(z.number().int().positive()).min(1).max(50), from: day.optional(), to: day.optional(), includeEvidence: z.boolean().optional(), includeNotes: z.boolean().optional(), title: z.string().max(200).optional() }), req.body)),
  );

  // ---------------- data & settings ----------------
  app.get('/api/coverage', async () => coverage(db));
  app.get('/api/runs', async () => all(db, 'SELECT id, provider, job, scope_json, started_at, finished_at, status, requests, items, error_class, message FROM ingestion_runs ORDER BY id DESC LIMIT 200'));
  app.get('/api/runs/:id', async (req) => {
    const r = get(db, 'SELECT * FROM ingestion_runs WHERE id = ?', [parse(idParam, req.params).id]);
    if (!r) throw new HttpError(404, 'Run not found');
    return r;
  });
  app.post('/api/ingest', async (req) => {
    liveOnly();
    const b = parse(z.object({ dryRun: z.boolean().default(false), markets: z.array(market).max(50).optional(), providers: z.array(z.string().max(40)).max(10).optional() }), req.body ?? {});
    if (b.dryRun) return runIngestion(db, cfg, { dryRun: true, markets: b.markets, providers: b.providers, transport: opts.transport });
    if (ingestRunning) throw new HttpError(409, 'An ingestion is already running');
    ingestRunning = runIngestion(db, cfg, { markets: b.markets, providers: b.providers, transport: opts.transport })
      .catch((e) => app.log.error(e))
      .finally(() => (ingestRunning = null));
    return { started: true };
  });
  app.get('/api/markets', async () => all(db, 'SELECT * FROM markets ORDER BY code'));
  app.post('/api/markets', async (req) => {
    const b = parse(z.object({ code: market, name: z.string().min(1).max(80), defaultLanguage: z.string().regex(/^[a-z]{2}$/).default('en'), notes: optStr(500) }), req.body);
    run(db, 'INSERT OR IGNORE INTO markets (code, name, default_language, enabled, notes) VALUES (?, ?, ?, 0, ?)', [b.code, b.name, b.defaultLanguage, b.notes ?? 'Added by user; validate before enabling.']);
    return { ok: true };
  });
  app.patch('/api/markets/:code', async (req) => {
    const code = parse(z.object({ code: market }), req.params).code;
    const b = parse(z.object({ enabled: z.boolean().optional(), notes: optStr(500) }), req.body);
    run(db, 'UPDATE markets SET enabled = COALESCE(?, enabled), notes = COALESCE(?, notes) WHERE code = ?', [b.enabled === undefined ? null : b.enabled ? 1 : 0, b.notes ?? null, code]);
    return { ok: true };
  });
  app.get('/api/taxonomy', async () => ({
    unified: all(db, 'SELECT u.*, (SELECT COUNT(*) FROM categories c WHERE c.unified_slug = u.slug) AS mapped FROM unified_categories u ORDER BY is_game, name'),
    categories: all(db, 'SELECT c.*, (SELECT COUNT(*) FROM listings l WHERE l.category_id = c.id) AS listings FROM categories c ORDER BY platform, is_game, name'),
  }));
  app.patch('/api/categories/:id', async (req) => {
    const b = parse(z.object({ unifiedSlug: z.string().max(40).nullable() }), req.body);
    if (b.unifiedSlug && !get(db, 'SELECT 1 FROM unified_categories WHERE slug = ?', [b.unifiedSlug])) throw new HttpError(400, 'Unknown unified category');
    run(db, 'UPDATE categories SET unified_slug = ? WHERE id = ?', [b.unifiedSlug, parse(idParam, req.params).id]);
    return { ok: true };
  });
  app.post('/api/unified', async (req) => {
    const b = parse(z.object({ slug: z.string().regex(/^[a-z0-9_]{2,40}$/), name: z.string().min(1).max(80), isGame: z.boolean().default(false) }), req.body);
    run(db, 'INSERT OR IGNORE INTO unified_categories (slug, name, is_game) VALUES (?, ?, ?)', [b.slug, b.name, b.isGame ? 1 : 0]);
    return { ok: true };
  });
  app.post('/api/backup', async () => ({ file: path.relative(ROOT, backupDb(db, cfg.backupDir, cfg.mode)) }));
  app.get('/api/public-preview', async () => {
    const d = buildPublicDataset(db, { maxListings: 50 });
    return { counts: { listings: d.listings.length, scopes: d.scopes.length, publicEvidence: d.publicEvidence.length }, excluded: ['private notes', 'non-public evidence', 'teardowns', 'first-party metrics', 'keywords', 'imports', 'descriptions', 'raw HTTP cache', 'run logs', 'imported/user listings'] };
  });
  app.get('/api/scopes/default', async () => {
    const s = listScopes(db).filter((x) => x.lastOkDay);
    const pick = s.find((x) => x.market === 'us' && x.device === 'iphone' && x.chartType === 'free' && x.category === 'all') ?? s[0];
    return { scopeId: pick?.id ?? null, lastDay: pick?.lastOkDay ?? null, since: pick ? addDays(pick.lastOkDay!, -30) : null };
  });

  // ---------------- static UI ----------------
  const dist = path.join(ROOT, 'dist');
  if (opts.serveStatic !== false && existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, wildcard: false });
    app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return { app, db };
}
