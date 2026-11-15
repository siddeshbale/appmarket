import { describe, expect, it } from 'vitest';
import { buildApp } from '../server/app';
import { get, run } from '../server/db';
import { seedDemo } from '../server/demo/seed';
import { commitImport, parseImport } from '../server/io/imports';
import { buildPublicDataset, compareData, researchBrief } from '../server/io/exports';
import { evidenceFor, qualifies, suggestLinks } from '../server/repo/links';
import { upsertListing, ensurePublisher } from '../server/repo/store';
import { loadConfig } from '../server/config';
import { runScenario } from '../shared/scenarios';
import { memDb, testConfig } from './helpers';

describe('imports', () => {
  it('previews types, bad rows and duplicates, then commits only valid rows with provenance', () => {
    const db = memDb();
    const csv = [
      'platform,store_id,market,observed_day,rating,rating_count,install_band,price,currency',
      'android,com.a.b,us,2026-10-01,4.5,1200,100K+,0,USD',
      'android,com.a.b,us,2026-10-01,4.5,1200,100K+,0,USD',
      'ios,notanid,us,2026-10-01,4.5,1,,,',
      'android,com.a.b,usa,2026-10-02,9,1,,,',
    ].join('\n');
    const p = parseImport(db, { kind: 'observations', format: 'csv', content: csv });
    expect(p.totals).toEqual({ total: 4, ok: 1, bad: 2, duplicate: 1 });
    expect(p.rows[3].issues.map((i) => i.field).sort()).toEqual(['market', 'rating']);
    const r = commitImport(db, p, { filename: 'x.csv' });
    expect(r.written).toBe(1);
    const o = get<any>(db, 'SELECT * FROM listing_observations');
    expect(o.provenance).toBe('imported');
    expect(o.import_id).toBe(r.importId);
    expect(o.install_lower_bound).toBe(100000);
    // re-importing the same file is a DB duplicate
    expect(parseImport(db, { kind: 'observations', format: 'csv', content: csv }).totals.duplicate).toBe(2);
  });
  it('imports chart snapshots with ties, separate from observed charts', () => {
    const db = memDb();
    const json = JSON.stringify([
      { platform: 'android', market: 'in', device: 'android_phone', chart_type: 'free', category: 'GAME_PUZZLE', snapshot_day: '2026-10-01', rank: 1, store_id: 'com.x.one', title: 'One' },
      { platform: 'android', market: 'in', device: 'android_phone', chart_type: 'free', category: 'GAME_PUZZLE', snapshot_day: '2026-10-01', rank: 2, store_id: 'com.x.two', title: 'Two' },
      { platform: 'android', market: 'in', device: 'android_phone', chart_type: 'free', category: 'GAME_PUZZLE', snapshot_day: '2026-10-01', rank: 2, store_id: 'com.x.three', title: 'Three' },
    ]);
    const p = parseImport(db, { kind: 'chart_snapshots', format: 'json', content: json });
    expect(p.totals.ok).toBe(3);
    commitImport(db, p, {});
    const s = get<any>(db, 'SELECT * FROM chart_snapshots');
    expect([s.provider, s.provenance, s.category_scope, s.observed_depth]).toEqual(['import', 'imported', 'category', 3]);
    expect(get<any>(db, 'SELECT COUNT(*) n FROM chart_entries WHERE rank = 2').n).toBe(2);
  });
  it('maps a Play Console export via the documented preset and keeps it private', () => {
    const db = memDb();
    const csv = 'Date,Package Name,Country,Daily User Installs,Mystery\n2026-10-01,com.mine.app,IN,120,7\n';
    const p = parseImport(db, { kind: 'first_party', format: 'csv', content: csv, preset: 'play_console_installs' });
    expect(p.totals.ok).toBe(1);
    expect(p.header).toContain('(ignored) Mystery');
    commitImport(db, p, {});
    expect(get<any>(db, 'SELECT metric, value, market FROM first_party_metrics')).toEqual({ metric: 'user_installs', value: 120, market: 'in' });
    expect(get<any>(db, 'SELECT is_private FROM imports').is_private).toBe(1);
  });
  it('requires a source and unit for user-owned keyword metrics', () => {
    const db = memDb();
    const p = parseImport(db, { kind: 'keywords', format: 'csv', content: 'phrase,search_volume\nhabit tracker,50\n' });
    expect(p.rows[0].issues.map((i) => i.field).sort()).toEqual(['source', 'volume_unit']);
  });
});

describe('cross-store matching', () => {
  it('never suggests on name similarity alone and flags ambiguity', () => {
    const db = memDb();
    const pi = ensurePublisher(db, 'ios', '1', 'Acme Inc.', null);
    const pa = ensurePublisher(db, 'android', null, 'ACME', null);
    const po = ensurePublisher(db, 'android', null, 'Other Studio', null);
    upsertListing(db, { platform: 'ios', storeId: '100001', title: 'Acme Notes', publisherId: pi, bundleId: 'com.acme.notes.ios' });
    upsertListing(db, { platform: 'android', storeId: 'com.acme.notes', title: 'Acme Notes', publisherId: pa });
    upsertListing(db, { platform: 'android', storeId: 'com.acme.noteslite', title: 'Acme Notes Lite', publisherId: pa });
    upsertListing(db, { platform: 'android', storeId: 'org.other.notes', title: 'Acme Notes', publisherId: po }); // same name, unrelated org
    expect(qualifies(evidenceFor({ title: 'Acme Notes', publisher_name: 'X' }, { title: 'Acme Notes', publisher_name: 'Y', store_id: 'org.y.z' }))).toBe(false);
    const r = suggestLinks(db);
    expect(r.created).toBe(2);
    expect(r.ambiguous).toBe(1);
    const links = db.prepare('SELECT * FROM listing_links').all() as any[];
    expect(links.every((l) => l.status === 'suggested')).toBe(true);
    expect(links.every((l) => JSON.parse(l.evidence_json).some((e: any) => /Ambiguous/.test(e.detail)))).toBe(true);
  });
});

describe('exports, public dataset and private-data exclusion', () => {
  it('compare export keeps provenance, identifiers, blanks and timestamps', () => {
    const db = memDb();
    seedDemo(db, { days: 12, today: '2026-11-10' });
    const ids = (db.prepare("SELECT id FROM listings WHERE platform='ios' LIMIT 2").all() as any[]).map((r) => r.id);
    const d = compareData(db, { ids, from: '2026-10-30', to: '2026-11-10' });
    expect(d.rankRows.length).toBeGreaterThan(0);
    expect(d.rankRows[0]).toHaveProperty('store_id');
    expect(d.rankRows[0]).toHaveProperty('provenance', 'demo');
    expect(d.rankRows.some((r: any) => r.rank === null && r.presence === 'no_data')).toBe(true); // seeded gap day
    const b = researchBrief(db, { ids });
    expect(b.markdown).toContain('Top grossing'.slice(0, 0) + 'Labels:');
    expect(b.prompt).toContain('Hypotheses');
  });
  it('public dataset excludes notes, private evidence, teardowns, descriptions, first-party and imported listings', () => {
    const db = memDb();
    seedDemo(db, { days: 8, today: '2026-11-10' });
    const lid = (db.prepare('SELECT id FROM listings LIMIT 1').get() as any).id;
    run(db, "INSERT INTO imports (kind, created_at, rows_total, rows_ok, rows_bad, rows_duplicate, summary_json) VALUES ('first_party','x',1,1,0,0,'{}')");
    run(db, "INSERT INTO first_party_metrics (import_id, listing_id, day, metric, value, source) VALUES (1, ?, '2026-11-01', 'proceeds', 999.5, 'secret')", [lid]);
    upsertListing(db, { platform: 'android', storeId: 'com.private.imported', title: 'Imported Private', provenance: 'imported', tracked: true });
    const ds = JSON.stringify(buildPublicDataset(db));
    expect(ds).not.toContain('Demo private note');
    expect(ds).not.toContain('"description"');
    expect(ds).not.toContain('proceeds');
    expect(ds).not.toContain('Fictional teardown');
    expect(ds).not.toContain('Imported Private');
    expect(ds).not.toContain('@demo_creator'); // non-public evidence
    expect(ds).toContain('demo-ad-1'); // evidence explicitly marked public (link only)
  });
});

describe('demo / live isolation', () => {
  it('uses separate database files per mode', () => {
    const prev = process.env.APP_MODE;
    process.env.APP_MODE = 'demo';
    const demo = loadConfig().dbPath;
    process.env.APP_MODE = 'live';
    const live = loadConfig().dbPath;
    process.env.APP_MODE = prev;
    expect(demo).not.toBe(live);
    expect(demo).toMatch(/demo\.db$/);
  });
  it('labels every seeded row as demo and blocks live requests in demo mode', async () => {
    const db = memDb();
    seedDemo(db, { days: 5, today: '2026-11-10' });
    expect(get<any>(db, "SELECT COUNT(*) n FROM listings WHERE provenance NOT IN ('demo','imported')").n).toBe(0);
    expect(get<any>(db, "SELECT COUNT(*) n FROM chart_snapshots WHERE provenance = 'observed'").n).toBe(0);
    const { app } = await buildApp({ config: testConfig({ mode: 'demo' }), db, serveStatic: false });
    const r = await app.inject({ method: 'POST', url: '/api/search/apple', headers: { 'x-radar-request': '1', 'content-type': 'application/json', host: '127.0.0.1' }, payload: JSON.stringify({ term: 'x', market: 'us' }) });
    expect(r.statusCode).toBe(409);
    await app.close();
  });
});

describe('local API protections', () => {
  it('rejects cross-origin and header-less writes, accepts same-origin', async () => {
    const { app } = await buildApp({ config: testConfig(), db: memDb(), serveStatic: false });
    const base = { method: 'POST' as const, url: '/api/watchlists', payload: JSON.stringify({ name: 'w' }) };
    const h = { 'content-type': 'application/json', host: '127.0.0.1:5174' };
    expect((await app.inject({ ...base, headers: { ...h, 'x-radar-request': '1', origin: 'https://attacker.example' } })).statusCode).toBe(403);
    expect((await app.inject({ ...base, headers: { ...h, 'x-radar-request': '1', 'sec-fetch-site': 'cross-site' } })).statusCode).toBe(403);
    expect((await app.inject({ ...base, headers: h })).statusCode).toBe(403);
    expect((await app.inject({ ...base, headers: { ...h, 'x-radar-request': '1', origin: 'http://127.0.0.1:5173' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/meta', headers: { host: 'rebind.attacker.example' } })).statusCode).toBe(421);
    await app.close();
  });
});

describe('monetization scenarios', () => {
  it('defaults to no data and computes visible formulas with separate currencies', () => {
    expect(runScenario({ model: 'ads_ecpm', currency: 'USD', values: {} }).status).toBe('no_data');
    const r = runScenario({ model: 'ads_ecpm', currency: 'USD', values: { impressions: { low: 1e6, base: 2e6, high: 3e6 }, ecpm: { low: 1, base: 2, high: 3 } } });
    expect(r).toMatchObject({ status: 'ok', low: 1000, base: 4000, high: 9000, currency: 'USD' });
    expect((r as any).converted).toBeUndefined();
    const fx = runScenario({ model: 'iap_payers', currency: 'USD', values: { payers: { low: 1, base: 1, high: 1 }, spend: { low: 10, base: 10, high: 10 } }, fxRate: 83, fxCurrency: 'INR' });
    expect((fx as any).converted.base).toBe(830);
    expect(runScenario({ model: 'subscription', currency: 'USD', values: { subs: { low: 1, base: 1, high: 1 }, price: { low: 1, base: 1, high: 1 }, discountShare: { low: 2, base: 0, high: 0 } } }).status).toBe('no_data');
  });
});
