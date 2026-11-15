// Read-side queries shared by the API, the alert generator, the brief generator and the public export.
import { addDays, dayRange, movementFor, newToChart, rankSeries, type Movement, type ScopeSnapshot } from '../../shared/ranks';
import type { SnapshotStatus } from '../../shared/types';
import { all, get, type Db } from '../db';

export interface Scope {
  provider: string;
  provenance: string;
  platform: string;
  market: string;
  device: string;
  chartType: string;
  category: string;
  categoryScope: string;
}

export const SCOPE_COLS = 'provider, provenance, platform, market, device, chart_type, category, category_scope';
const scopeWhere = 'provider = ? AND provenance = ? AND platform = ? AND market = ? AND device = ? AND chart_type = ? AND category = ? AND category_scope = ?';
export const scopeParams = (s: Scope) => [s.provider, s.provenance, s.platform, s.market, s.device, s.chartType, s.category, s.categoryScope];

export function scopeId(s: Scope): string {
  return [s.provider, s.provenance, s.platform, s.market, s.device, s.chartType, s.category, s.categoryScope].join('~');
}
export function parseScopeId(id: string): Scope | null {
  const p = String(id ?? '').split('~');
  if (p.length !== 8 || p.some((x) => !/^[A-Za-z0-9_.-]{1,40}$/.test(x))) return null;
  return { provider: p[0], provenance: p[1], platform: p[2], market: p[3], device: p[4], chartType: p[5], category: p[6], categoryScope: p[7] };
}

export function listScopes(db: Db) {
  const rows = all<any>(
    db,
    `SELECT ${SCOPE_COLS}, COUNT(*) AS days, MIN(snapshot_day) AS first_day, MAX(snapshot_day) AS last_day,
        SUM(CASE WHEN status IN ('complete','partial') THEN 1 ELSE 0 END) AS ok_days,
        MAX(CASE WHEN status IN ('complete','partial') THEN snapshot_day END) AS last_ok_day,
        MAX(observed_depth) AS max_depth
     FROM chart_snapshots GROUP BY ${SCOPE_COLS} ORDER BY platform, market, provider, device, chart_type, category`,
  );
  const catNames = new Map(all<any>(db, 'SELECT platform, store_category_id, name FROM categories').map((c) => [`${c.platform}:${c.store_category_id}`, c.name]));
  return rows.map((r) => {
    const s: Scope = { provider: r.provider, provenance: r.provenance, platform: r.platform, market: r.market, device: r.device, chartType: r.chart_type, category: r.category, categoryScope: r.category_scope };
    const last = get<any>(db, `SELECT status, observed_depth, requested_depth, error_class, fetched_at FROM chart_snapshots WHERE ${scopeWhere} ORDER BY snapshot_day DESC LIMIT 1`, scopeParams(s));
    return {
      id: scopeId(s),
      ...s,
      categoryName: s.category === 'all' ? 'All categories' : (catNames.get(`${s.platform}:${s.category}`) ?? s.category),
      days: r.days,
      okDays: r.ok_days,
      firstDay: r.first_day,
      lastDay: r.last_day,
      lastOkDay: r.last_ok_day,
      maxDepth: r.max_depth,
      lastStatus: last?.status as SnapshotStatus,
      lastDepth: last?.observed_depth ?? 0,
      lastRequestedDepth: last?.requested_depth ?? null,
      lastError: last?.error_class ?? null,
      lastFetchedAt: last?.fetched_at ?? null,
    };
  });
}

export function loadScopeSnapshots(db: Db, s: Scope, from: string, to: string): ScopeSnapshot[] {
  const snaps = all<any>(db, `SELECT id, snapshot_day, status, observed_depth FROM chart_snapshots WHERE ${scopeWhere} AND snapshot_day BETWEEN ? AND ? ORDER BY snapshot_day`, [
    ...scopeParams(s), from, to,
  ]);
  if (!snaps.length) return [];
  const ids = snaps.map((x) => x.id);
  const entries = all<any>(db, `SELECT snapshot_id, listing_id, rank FROM chart_entries WHERE snapshot_id IN (${ids.map(() => '?').join(',')})`, ids);
  const bySnap = new Map<number, Map<number, number>>();
  for (const e of entries) {
    if (!bySnap.has(e.snapshot_id)) bySnap.set(e.snapshot_id, new Map());
    bySnap.get(e.snapshot_id)!.set(e.listing_id, e.rank);
  }
  return snaps.map((x) => ({ day: x.snapshot_day, status: x.status, observedDepth: x.observed_depth, ranks: bySnap.get(x.id) ?? new Map() }));
}

export function latestOkDay(db: Db, s: Scope, onOrBefore?: string): string | null {
  const r = get<any>(
    db,
    `SELECT MAX(snapshot_day) AS d FROM chart_snapshots WHERE ${scopeWhere} AND status IN ('complete','partial') ${onOrBefore ? 'AND snapshot_day <= ?' : ''}`,
    onOrBefore ? [...scopeParams(s), onOrBefore] : scopeParams(s),
  );
  return r?.d ?? null;
}

const LISTING_COLS = `l.id, l.platform, l.store_id, l.title, l.icon_url, l.is_game, l.release_date, l.provenance, l.tracked,
  p.id AS publisher_id, p.name AS publisher_name, c.store_category_id AS category_id, c.name AS category_name, c.unified_slug, u.name AS unified_name`;
const LISTING_JOINS = `LEFT JOIN publishers p ON p.id = l.publisher_id LEFT JOIN categories c ON c.id = l.category_id LEFT JOIN unified_categories u ON u.slug = c.unified_slug`;

export function listingsByIds(db: Db, ids: number[]): Map<number, any> {
  if (!ids.length) return new Map();
  const out = new Map<number, any>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of all<any>(db, `SELECT ${LISTING_COLS} FROM listings l ${LISTING_JOINS} WHERE l.id IN (${chunk.map(() => '?').join(',')})`, chunk)) out.set(r.id, r);
  }
  return out;
}

export interface ChartViewOptions {
  day?: string;
  unified?: string; // unified category slug for a filtered subset
  priceType?: 'free' | 'paid';
  releasedAfter?: string;
  releasedBefore?: string;
}

/** Latest (or selected day) chart with 1-day and 7-day movement. Filtering by genre is reported as a filtered subset. */
export function chartView(db: Db, s: Scope, o: ChartViewOptions = {}) {
  const day = latestOkDay(db, s, o.day);
  if (!day) return { scope: s, scopeId: scopeId(s), day: null, snapshot: null, rows: [], filteredSubset: false };
  const snaps = loadScopeSnapshots(db, s, addDays(day, -40), day);
  const snap = get<any>(db, `SELECT * FROM chart_snapshots WHERE ${scopeWhere} AND snapshot_day = ?`, [...scopeParams(s), day]);
  const entries = all<any>(db, 'SELECT listing_id, rank, price, currency FROM chart_entries WHERE snapshot_id = ? ORDER BY rank', [snap.id]);
  const meta = listingsByIds(db, entries.map((e) => e.listing_id));
  let rows = entries.map((e) => {
    const l = meta.get(e.listing_id);
    const m1 = movementFor(e.listing_id, snaps, day, 1, 0);
    const m7 = movementFor(e.listing_id, snaps, day, 7, 2);
    return { ...l, rank: e.rank, price: e.price, currency: e.currency, move1: m1, move7: m7 };
  });
  const filteredSubset = !!(o.unified || o.priceType || o.releasedAfter || o.releasedBefore);
  if (o.unified) rows = rows.filter((r) => r.unified_slug === o.unified || (o.unified === 'games' && r.is_game));
  if (o.priceType === 'free') rows = rows.filter((r) => r.price === 0 || (r.price == null && s.chartType === 'free'));
  if (o.priceType === 'paid') rows = rows.filter((r) => (r.price ?? 0) > 0 || (r.price == null && s.chartType === 'paid'));
  if (o.releasedAfter) rows = rows.filter((r) => r.release_date && r.release_date >= o.releasedAfter!);
  if (o.releasedBefore) rows = rows.filter((r) => r.release_date && r.release_date <= o.releasedBefore!);
  return {
    scope: s,
    scopeId: scopeId(s),
    day,
    snapshot: { status: snap.status, observedDepth: snap.observed_depth, requestedDepth: snap.requested_depth, fetchedAt: snap.fetched_at, sourceUrl: snap.source_url, provider: snap.provider, provenance: snap.provenance },
    rows,
    filteredSubset,
  };
}

export function moversView(db: Db, s: Scope, windowDays: 7 | 30 | 1, day?: string) {
  const d = latestOkDay(db, s, day);
  if (!d) return { scopeId: scopeId(s), day: null, window: windowDays, rows: [] as any[], comparedDay: null, insufficient: true };
  const snaps = loadScopeSnapshots(db, s, addDays(d, -(windowDays + 40)), d);
  const cur = snaps.find((x) => x.day === d)!;
  const moves: Movement[] = [];
  for (const id of cur.ranks.keys()) moves.push(movementFor(id, snaps, d, windowDays, windowDays >= 7 ? 2 : 0));
  // listings that dropped out: in comparison chart but not now
  const compared = moves.find((m) => m.comparedDay)?.comparedDay ?? null;
  const meta = listingsByIds(db, moves.map((m) => m.listingId));
  const rows = moves.map((m) => ({ ...meta.get(m.listingId), movement: m }));
  const dropped: any[] = [];
  if (compared) {
    const prev = snaps.find((x) => x.day === compared)!;
    const dm = listingsByIds(db, [...prev.ranks.keys()].filter((id) => !cur.ranks.has(id)));
    for (const [id, r] of prev.ranks) if (!cur.ranks.has(id)) dropped.push({ ...dm.get(id), previousRank: r, explanation: `#${r} on ${compared}; outside the observed top ${cur.observedDepth} on ${d}.` });
  }
  return { scopeId: scopeId(s), day: d, window: windowDays, comparedDay: compared, insufficient: !compared, rows, dropped: dropped.sort((a, b) => a.previousRank - b.previousRank) };
}

export function newToChartView(db: Db, s: Scope, day?: string) {
  const d = latestOkDay(db, s, day);
  if (!d) return { scopeId: scopeId(s), day: null, rows: [], comparedDay: null };
  const snaps = loadScopeSnapshots(db, s, addDays(d, -120), d);
  const moves = newToChart(snaps, d);
  const meta = listingsByIds(db, moves.map((m) => m.listingId));
  return { scopeId: scopeId(s), day: d, comparedDay: moves[0]?.comparedDay ?? (snaps.length > 1 ? snaps[snaps.length - 2].day : null), rows: moves.map((m) => ({ ...meta.get(m.listingId), movement: m })) };
}

export interface CatalogQuery {
  q?: string;
  platform?: string;
  market?: string;
  unified?: string;
  kind?: 'apps' | 'games';
  priceType?: 'free' | 'paid';
  releasedAfter?: string;
  releasedBefore?: string;
  tracked?: boolean;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export function catalog(db: Db, q: CatalogQuery) {
  const where: string[] = [];
  const params: any[] = [];
  const market = q.market && /^[a-z]{2}$/.test(q.market) ? q.market : null;
  if (q.q) {
    const term = q.q.trim().slice(0, 100);
    where.push('(l.title LIKE ? ESCAPE \'\\\' OR p.name LIKE ? ESCAPE \'\\\' OR l.store_id = ?)');
    const like = '%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    params.push(like, like, term);
  }
  if (q.platform === 'ios' || q.platform === 'android') {
    where.push('l.platform = ?');
    params.push(q.platform);
  }
  if (q.unified) {
    where.push('(c.unified_slug = ? OR (? = \'games\' AND l.is_game = 1))');
    params.push(q.unified, q.unified);
  }
  if (q.kind === 'games') where.push('l.is_game = 1');
  if (q.kind === 'apps') where.push('l.is_game = 0');
  if (q.tracked) where.push('l.tracked = 1');
  if (q.releasedAfter) {
    where.push('l.release_date >= ?');
    params.push(q.releasedAfter);
  }
  if (q.releasedBefore) {
    where.push('l.release_date <= ?');
    params.push(q.releasedBefore);
  }
  if (market) {
    where.push(`(EXISTS (SELECT 1 FROM listing_observations o WHERE o.listing_id = l.id AND o.market = ?) OR EXISTS (SELECT 1 FROM chart_entries e JOIN chart_snapshots s ON s.id = e.snapshot_id WHERE e.listing_id = l.id AND s.market = ?))`);
    params.push(market, market);
  }
  const obsJoin = `LEFT JOIN listing_observations lo ON lo.id = (SELECT o2.id FROM listing_observations o2 WHERE o2.listing_id = l.id ${market ? 'AND o2.market = ?' : ''} AND o2.availability = 'available' ORDER BY o2.snapshot_day DESC, o2.id DESC LIMIT 1)`;
  const obsParams = market ? [market] : [];
  if (q.priceType === 'free') where.push('lo.price = 0');
  if (q.priceType === 'paid') where.push('lo.price > 0');
  const sortCols: Record<string, string> = {
    title: 'l.title COLLATE NOCASE', publisher: 'p.name COLLATE NOCASE', rating: 'lo.rating', ratings: 'lo.rating_count', release: 'l.release_date',
    updated: 'lo.store_updated_at', price: 'lo.price', installs: 'lo.install_lower_bound', seen: 'l.last_seen_at',
  };
  const sort = sortCols[q.sort ?? ''] ?? 'l.last_seen_at';
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const pageSize = Math.max(1, Math.min(200, q.pageSize ?? 50));
  const page = Math.max(1, q.page ?? 1);
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = get<any>(db, `SELECT COUNT(*) AS n FROM listings l ${LISTING_JOINS} ${obsJoin} ${w}`, [...obsParams, ...params]).n;
  const rows = all<any>(
    db,
    `SELECT ${LISTING_COLS}, lo.market AS obs_market, lo.price, lo.currency, lo.rating, lo.rating_count, lo.install_band, lo.version, lo.store_updated_at, lo.snapshot_day AS obs_day, lo.provenance AS obs_provenance
     FROM listings l ${LISTING_JOINS} ${obsJoin} ${w} ORDER BY ${sort} IS NULL, ${sort} ${dir}, l.id LIMIT ? OFFSET ?`,
    [...obsParams, ...params, pageSize, (page - 1) * pageSize],
  );
  return { total, page, pageSize, rows };
}

export function listingProfile(db: Db, id: number, opts: { from?: string; to?: string; includePrivate?: boolean } = {}) {
  const l = get<any>(db, `SELECT ${LISTING_COLS}, l.first_seen_at, l.last_seen_at, l.product_id, p.url AS publisher_url FROM listings l ${LISTING_JOINS} WHERE l.id = ?`, [id]);
  if (!l) return null;
  const observations = all<any>(
    db,
    `SELECT id, market, language, provider, provenance, snapshot_day, observed_at, source_url, availability, title, version, store_updated_at, release_date, price, currency,
       rating, rating_count, rating_scope, install_band, install_lower_bound, has_ads, has_iap, content_rating, genre_label${opts.includePrivate ? ', description' : ''}
     FROM listing_observations WHERE listing_id = ? ORDER BY market, snapshot_day`,
    [id],
  );
  const scopeRows = all<any>(db, `SELECT DISTINCT ${SCOPE_COLS.split(', ').map((c) => 's.' + c).join(', ')} FROM chart_entries e JOIN chart_snapshots s ON s.id = e.snapshot_id WHERE e.listing_id = ?`, [id]);
  const to = opts.to ?? new Date().toISOString().slice(0, 10);
  const from = opts.from ?? addDays(to, -89);
  const catNames = new Map(all<any>(db, 'SELECT platform, store_category_id, name FROM categories').map((c) => [`${c.platform}:${c.store_category_id}`, c.name]));
  const charts = scopeRows.map((r) => {
    const s: Scope = { provider: r.provider, provenance: r.provenance, platform: r.platform, market: r.market, device: r.device, chartType: r.chart_type, category: r.category, categoryScope: r.category_scope };
    const snaps = loadScopeSnapshots(db, s, from, to);
    const series = rankSeries(id, snaps, dayRange(from, to));
    const best = series.reduce((b, p) => (p.rank !== null && (b === null || p.rank < b) ? p.rank : b), null as number | null);
    const latest = [...series].reverse().find((p) => p.presence !== 'no_data');
    return { scopeId: scopeId(s), scope: s, categoryName: s.category === 'all' ? 'All categories' : (catNames.get(`${s.platform}:${s.category}`) ?? s.category), series, best, latest };
  });
  const related = l.publisher_id
    ? all<any>(db, `SELECT ${LISTING_COLS} FROM listings l ${LISTING_JOINS} WHERE l.publisher_id = ? AND l.id != ? ORDER BY l.title LIMIT 50`, [l.publisher_id, id])
    : [];
  const links = all<any>(
    db,
    `SELECT k.id, k.status, k.evidence_json, k.created_at, k.reviewed_at, CASE WHEN k.listing_a = ? THEN k.listing_b ELSE k.listing_a END AS other_id
     FROM listing_links k WHERE (k.listing_a = ? OR k.listing_b = ?) AND k.status != 'rejected'`,
    [id, id, id],
  );
  const others = listingsByIds(db, links.map((k) => k.other_id));
  const crossStore = links.map((k) => ({ id: k.id, status: k.status, evidence: JSON.parse(k.evidence_json), createdAt: k.created_at, reviewedAt: k.reviewed_at, listing: others.get(k.other_id) }));
  const result: any = { listing: l, observations, charts, related, crossStore: opts.includePrivate ? crossStore : crossStore.filter((c) => c.status === 'verified') };
  if (opts.includePrivate) {
    result.notes = all<any>(db, 'SELECT * FROM private_notes WHERE listing_id = ? ORDER BY created_at DESC', [id]);
    result.evidence = all<any>(db, 'SELECT * FROM evidence WHERE listing_id = ? ORDER BY COALESCE(first_observed, created_at) DESC', [id]);
    result.teardowns = all<any>(db, 'SELECT * FROM onboarding_teardowns WHERE listing_id = ? ORDER BY observed_at DESC', [id]);
    result.watchlists = all<any>(db, 'SELECT w.id, w.name FROM watchlist_items i JOIN watchlists w ON w.id = i.watchlist_id WHERE i.listing_id = ?', [id]);
    result.firstParty = all<any>(db, 'SELECT day, metric, value, unit, market, source FROM first_party_metrics WHERE listing_id = ? ORDER BY day', [id]);
  }
  return result;
}

export function publisherProfile(db: Db, id: number) {
  const p = get<any>(db, 'SELECT * FROM publishers WHERE id = ?', [id]);
  if (!p) return null;
  const listings = all<any>(
    db,
    `SELECT ${LISTING_COLS}, (SELECT MIN(e.rank) FROM chart_entries e WHERE e.listing_id = l.id) AS best_rank FROM listings l ${LISTING_JOINS} WHERE l.publisher_id = ? ORDER BY l.title`,
    [id],
  );
  return { publisher: p, listings };
}

export function coverage(db: Db) {
  const scopes = listScopes(db);
  const runs = all<any>(
    db,
    `SELECT provider, MAX(CASE WHEN status IN ('success','partial') THEN finished_at END) AS last_success, MAX(started_at) AS last_run,
      (SELECT r2.status FROM ingestion_runs r2 WHERE r2.provider = r.provider ORDER BY r2.id DESC LIMIT 1) AS last_status,
      (SELECT r2.message FROM ingestion_runs r2 WHERE r2.provider = r.provider ORDER BY r2.id DESC LIMIT 1) AS last_message
     FROM ingestion_runs r GROUP BY provider`,
  );
  const now = Date.now();
  const providerStatus = runs.map((r) => ({ ...r, stale: !r.last_success || now - Date.parse(r.last_success) > 36 * 3600 * 1000 }));
  const obsCoverage = all<any>(
    db,
    `SELECT provider, provenance, market, COUNT(DISTINCT listing_id) AS listings, COUNT(*) AS observations, MIN(snapshot_day) AS first_day, MAX(snapshot_day) AS last_day,
       SUM(CASE WHEN availability = 'unavailable' THEN 1 ELSE 0 END) AS unavailable
     FROM listing_observations GROUP BY provider, provenance, market ORDER BY provider, market`,
  );
  const counts = get<any>(
    db,
    `SELECT (SELECT COUNT(*) FROM listings) AS listings, (SELECT COUNT(*) FROM listings WHERE platform='ios') AS ios, (SELECT COUNT(*) FROM listings WHERE platform='android') AS android,
      (SELECT COUNT(*) FROM chart_snapshots) AS snapshots, (SELECT COUNT(*) FROM listing_observations) AS observations, (SELECT COUNT(*) FROM publishers) AS publishers,
      (SELECT COUNT(*) FROM evidence) AS evidence, (SELECT COUNT(*) FROM imports) AS imports`,
  );
  return { scopes, providerStatus, obsCoverage, counts };
}
