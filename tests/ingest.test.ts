import { describe, expect, it } from 'vitest';
import { all, get, run } from '../server/db';
import { PoliteClient, ProviderError } from '../server/http/client';
import { runIngestion } from '../server/ingest/run';
import { catalog, chartView, listScopes, parseScopeId } from '../server/repo/query';
import { upsertListing } from '../server/repo/store';
import { FIX, fixtureTransport, legacyFeed, lookupPayload, memDb, noSleep, testConfig } from './helpers';

const usFeed = legacyFeed([{ id: '111111', name: 'Alpha Notes' }, { id: '222222', name: 'Beta Budget' }, { id: '333333', name: 'Gamma Fit' }]);
const inFeed = legacyFeed([{ id: '444444', name: 'India Pay', currency: 'INR' }, { id: '111111', name: 'Alpha Notes', currency: 'INR' }], '2026-11-10T03:00:00-07:00');

function appleRoutes(over: Record<string, any> = {}) {
  return (url: string) => {
    for (const [k, v] of Object.entries(over)) if (url.includes(k)) return typeof v === 'function' ? v(url) : v;
    if (url.includes('/us/rss/')) return { status: 200, body: usFeed };
    if (url.includes('/in/rss/')) return { status: 200, body: inFeed };
    if (url.includes('/lookup')) {
      const ids = new URL(url).searchParams.get('id')!.split(',');
      return { status: 200, body: lookupPayload(ids.filter((i) => i !== '444444' || url.includes('country=in')).map((i) => ({ trackId: Number(i), trackName: `App ${i}` }))) };
    }
    if (url.includes('play.google.com')) return { status: 200, body: FIX('play-details.html') };
    return { status: 404, body: '' };
  };
}

describe('polite HTTP client', () => {
  it('backs off on 429 honoring Retry-After, then succeeds', async () => {
    let n = 0;
    const waits: number[] = [];
    const t = fixtureTransport(() => (n++ === 0 ? { status: 429, body: '', headers: { 'Retry-After': '2' } } : { status: 200, body: '{}' }));
    const c = new PoliteClient({ provider: 'x', budget: 5, minIntervalMs: 0, timeoutMs: 1000, maxRetries: 2, maxConcurrency: 1, cacheTtlMin: 0 }, null, () => {}, t, async (ms) => void waits.push(ms));
    const r = await c.getText('https://itunes.apple.com/lookup?id=1');
    expect(r.status).toBe(200);
    expect(waits).toContain(2000);
    expect(c.used).toBe(2);
  });
  it('stops the provider on access restrictions and does not retry', async () => {
    const t = fixtureTransport(() => ({ status: 403, body: 'forbidden' }));
    const c = new PoliteClient({ provider: 'x', budget: 5, minIntervalMs: 0, timeoutMs: 1000, maxRetries: 3, maxConcurrency: 1, cacheTtlMin: 0 }, null, () => {}, t, noSleep);
    await expect(c.getText('https://play.google.com/store/apps/details?id=a.b')).rejects.toMatchObject({ errorClass: 'restricted' });
    await expect(c.getText('https://play.google.com/store/apps/details?id=c.d')).rejects.toMatchObject({ errorClass: 'restricted' });
    expect(t.calls).toHaveLength(1);
  });
  it('treats CAPTCHA interstitials as restricted', async () => {
    const t = fixtureTransport(() => ({ status: 200, body: '<html>Our systems have detected unusual traffic</html>' }));
    const c = new PoliteClient({ provider: 'x', budget: 5, minIntervalMs: 0, timeoutMs: 1000, maxRetries: 3, maxConcurrency: 1, cacheTtlMin: 0 }, null, () => {}, t, noSleep);
    await expect(c.getText('https://play.google.com/store/apps/details?id=a.b')).rejects.toMatchObject({ errorClass: 'restricted' });
  });
  it('enforces the request budget and the host allowlist', async () => {
    const t = fixtureTransport(() => ({ status: 500, body: '' }));
    const c = new PoliteClient({ provider: 'x', budget: 2, minIntervalMs: 0, timeoutMs: 1000, maxRetries: 5, maxConcurrency: 1, cacheTtlMin: 0 }, null, () => {}, t, noSleep);
    await expect(c.getText('https://itunes.apple.com/x')).rejects.toMatchObject({ errorClass: 'budget_exhausted' });
    expect(t.calls).toHaveLength(2);
    await expect(c.getText('https://example.com/x')).rejects.toBeInstanceOf(ProviderError);
  });
  it('classifies timeouts', async () => {
    const t = fixtureTransport(() => new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), 5)));
    const c = new PoliteClient({ provider: 'x', budget: 1, minIntervalMs: 0, timeoutMs: 1000, maxRetries: 0, maxConcurrency: 1, cacheTtlMin: 0 }, null, () => {}, t, noSleep);
    await expect(c.getText('https://itunes.apple.com/x')).rejects.toMatchObject({ errorClass: 'timeout' });
  });
});

describe('ingestion', () => {
  it('deduplicates reruns of the same verified scope and day', async () => {
    const db = memDb();
    const transport = fixtureTransport(appleRoutes());
    const cfg = testConfig();
    await runIngestion(db, cfg, { transport, sleeper: noSleep, providers: ['apple-itunes-rss'] });
    await runIngestion(db, cfg, { transport, sleeper: noSleep, providers: ['apple-itunes-rss'] });
    expect(get<any>(db, 'SELECT COUNT(*) n FROM chart_snapshots').n).toBe(2); // us + in, once each
    expect(get<any>(db, 'SELECT COUNT(*) n FROM chart_entries').n).toBe(5);
    expect(all<any>(db, 'SELECT status FROM ingestion_runs').every((r) => r.status === 'success')).toBe(true);
  });

  it('keeps countries isolated', async () => {
    const db = memDb();
    await runIngestion(db, testConfig(), { transport: fixtureTransport(appleRoutes()), sleeper: noSleep, providers: ['apple-itunes-rss', 'itunes-lookup'] });
    const inScope = listScopes(db).find((s) => s.market === 'in')!;
    const view = chartView(db, parseScopeId(inScope.id)!);
    expect(view.rows.map((r: any) => r.store_id)).toEqual(['444444', '111111']);
    // India Pay only observed in IN; never appears in a US catalog query
    expect(catalog(db, { market: 'us', q: '444444' }).total).toBe(0);
    expect(catalog(db, { market: 'in', q: '444444' }).total).toBe(1);
    const prices = all<any>(db, "SELECT DISTINCT market, currency FROM chart_entries e JOIN chart_snapshots s ON s.id = e.snapshot_id");
    expect(prices).toEqual(expect.arrayContaining([{ market: 'us', currency: 'USD' }, { market: 'in', currency: 'INR' }]));
  });

  it('isolates a failing source from a successful one and keeps prior verified data', async () => {
    const db = memDb();
    const cfg = testConfig({ ingestMarkets: ['us'] });
    await runIngestion(db, cfg, { transport: fixtureTransport(appleRoutes()), sleeper: noSleep, providers: ['apple-itunes-rss'] });
    const before = get<any>(db, 'SELECT COUNT(*) n FROM chart_entries').n;
    // Now charts fail (malformed) while lookup works
    const res = await runIngestion(db, cfg, {
      transport: fixtureTransport(appleRoutes({ '/rss/': { status: 200, body: '<html>not json</html>' } })),
      sleeper: noSleep,
      providers: ['apple-itunes-rss', 'itunes-lookup'],
    });
    const byP = Object.fromEntries(res.providers.map((p) => [p.provider, p]));
    expect(byP['apple-itunes-rss'].status).toBe('failed');
    expect(byP['apple-itunes-rss'].errors[0].errorClass).toBe('malformed');
    expect(byP['itunes-lookup'].status).toBe('success');
    expect(get<any>(db, 'SELECT COUNT(*) n FROM chart_entries').n).toBe(before);
    expect(get<any>(db, "SELECT status FROM chart_snapshots WHERE market='us'").status).toBe('complete'); // same day: failure does not overwrite
  });

  it('reads registered Android packages and records restricted access without breaking iOS', async () => {
    const db = memDb();
    upsertListing(db, { platform: 'android', storeId: 'com.fixture.planner', title: 'com.fixture.planner', provenance: 'user', tracked: true });
    const res = await runIngestion(db, testConfig({ ingestMarkets: ['in'] }), {
      transport: fixtureTransport(appleRoutes({ 'play.google.com': { status: 403, body: '' } })),
      sleeper: noSleep,
      providers: ['apple-itunes-rss', 'google-play-details'],
    });
    const byP = Object.fromEntries(res.providers.map((p) => [p.provider, p]));
    expect(byP['google-play-details'].status).toBe('restricted');
    expect(byP['apple-itunes-rss'].status).toBe('success');
    const ok = await runIngestion(db, testConfig({ ingestMarkets: ['in'] }), { transport: fixtureTransport(appleRoutes()), sleeper: noSleep, providers: ['google-play-details'] });
    expect(ok.providers[0].status).toBe('success');
    const o = get<any>(db, "SELECT * FROM listing_observations WHERE provider = 'google-play-details'");
    expect(o.install_band).toBe('1M+');
    expect(o.install_lower_bound).toBe(1000000);
    expect(o.market).toBe('in');
  });

  it('skips markets not enabled in the registry and supports dry-run with no writes', async () => {
    const db = memDb();
    const t = fixtureTransport(appleRoutes());
    const res = await runIngestion(db, testConfig({ ingestMarkets: ['us', 'jp'] }), { transport: t, dryRun: true, sleeper: noSleep });
    expect(res.skippedMarkets).toEqual(['jp']);
    expect(t.calls).toHaveLength(0);
    expect(get<any>(db, 'SELECT COUNT(*) n FROM ingestion_runs').n).toBe(0);
    expect(res.providers.find((p) => p.provider === 'apple-itunes-rss')!.planned![0]).toContain('/us/rss/topfreeapplications/limit=3/json');
  });

  it('refuses live ingestion in demo mode', async () => {
    await expect(runIngestion(memDb(), testConfig({ mode: 'demo' }), {})).rejects.toThrow(/demo/);
  });

  it('generates deduplicated alerts for watchlisted listings', async () => {
    const db = memDb();
    const cfg = testConfig({ ingestMarkets: ['us'], alertRankThreshold: 1 });
    await runIngestion(db, cfg, { transport: fixtureTransport(appleRoutes()), sleeper: noSleep, providers: ['apple-itunes-rss'] });
    const id = get<any>(db, "SELECT id FROM listings WHERE store_id='333333'").id;
    run(db, "INSERT INTO watchlists (name, created_at) VALUES ('w', 'x')");
    run(db, 'INSERT INTO watchlist_items (watchlist_id, listing_id, added_at) VALUES (1, ?, ?)', [id, 'x']);
    // simulate yesterday's snapshot where 333333 was #1
    const snap = get<any>(db, "SELECT * FROM chart_snapshots WHERE market='us'");
    const y = new Date(Date.parse(snap.snapshot_day) - 86400000).toISOString().slice(0, 10);
    run(db, `INSERT INTO chart_snapshots (provider, provenance, platform, market, device, chart_type, category, category_scope, snapshot_day, fetched_at, requested_depth, observed_depth, status)
             VALUES ('apple-itunes-rss','observed','ios','us','iphone','free','all','all',?,?,3,3,'complete')`, [y, y]);
    const sid = get<any>(db, 'SELECT id FROM chart_snapshots WHERE snapshot_day = ?', [y]).id;
    run(db, 'INSERT INTO chart_entries (snapshot_id, listing_id, rank) VALUES (?, ?, 1)', [sid, id]);
    const { generateAlerts } = await import('../server/ingest/alerts');
    expect(generateAlerts(db, 1, null)).toBe(1);
    expect(generateAlerts(db, 1, null)).toBe(0);
    expect(get<any>(db, 'SELECT type, message FROM alerts').type).toBe('rank_move');
  });
});
