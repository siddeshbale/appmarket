// API smoke test against a throwaway in-memory demo database (no network).
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { migrate, openDb } from '../db';
import { seedDemo } from '../demo/seed';

const cfg = { ...loadConfig(), mode: 'demo' as const, dbPath: ':memory:' };
const db = openDb(':memory:');
migrate(db);
seedDemo(db);
const { app } = await buildApp({ config: cfg, db, serveStatic: true });
const H = { 'x-radar-request': '1', 'content-type': 'application/json', host: '127.0.0.1:5174' };
let fails = 0;
async function check(name: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown, expect = 200, headers: Record<string, string> = H) {
  const r = await app.inject({ method, url, headers, payload: body === undefined ? undefined : JSON.stringify(body) });
  const ok = r.statusCode === expect;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${url} -> ${r.statusCode}${ok ? '' : ' ' + r.body.slice(0, 200)} ${name}`);
  try {
    return JSON.parse(r.body);
  } catch {
    return r.body;
  }
}
const meta = await check('meta', 'GET', '/api/meta');
const scopes = await check('scopes', 'GET', '/api/scopes');
const sid = encodeURIComponent(scopes[0].id);
const chart = await check('chart', 'GET', `/api/charts?scope=${sid}`);
await check('movers 7', 'GET', `/api/movers?scope=${sid}&window=7`);
await check('movers 30', 'GET', `/api/movers?scope=${sid}&window=30`);
await check('new to chart', 'GET', `/api/new-to-chart?scope=${sid}`);
await check('bad scope', 'GET', '/api/charts?scope=../../etc', undefined, 400);
const cat = await check('catalog', 'GET', '/api/catalog?q=Lumen&market=us');
const lid = chart.rows[0].id;
const prof = await check('listing', 'GET', `/api/listings/${lid}`);
await check('publisher', 'GET', `/api/publishers/${prof.listing.publisher_id}`);
await check('lookup android in demo (registers)', 'POST', '/api/lookup', { input: 'https://play.google.com/store/apps/details?id=com.example.radar', market: 'us' });
await check('lookup rejects arbitrary url', 'POST', '/api/lookup', { input: 'https://evil.example.com/id12345', market: 'us' }, 400);
await check('ingest blocked in demo', 'POST', '/api/ingest', {}, 409);
await check('write without header rejected', 'POST', '/api/watchlists', { name: 'x' }, 403, { 'content-type': 'application/json', host: '127.0.0.1:5174' });
await check('cross-origin write rejected', 'POST', '/api/watchlists', { name: 'x' }, 403, { ...H, origin: 'https://evil.example.com' });
await check('dns rebinding host rejected', 'GET', '/api/meta', undefined, 421, { host: 'evil.example.com' });
const wl = await check('create watchlist', 'POST', '/api/watchlists', { name: 'Smoke list' });
await check('add item', 'POST', `/api/watchlists/${wl.id}/items`, { listingId: lid });
await check('watchlists', 'GET', '/api/watchlists');
await check('alerts', 'GET', '/api/alerts');
await check('evidence add', 'POST', '/api/evidence', { kind: 'paid_ad', listingId: lid, channel: 'meta', hook: 'Smoke', url: 'https://example.com/x', metrics: [{ label: 'Impressions', value: '1K-5K', scope: 'US' }] });
await check('evidence bad url', 'POST', '/api/evidence', { kind: 'paid_ad', url: 'javascript:alert(1)' }, 400);
await check('evidence list', 'GET', '/api/evidence?q=Smoke');
await check('teardown add', 'POST', '/api/teardowns', { listingId: lid, observedAt: '2026-01-01', paywallTiming: 'after onboarding' });
await check('keyword lab', 'POST', '/api/keywords/lab', { ids: cat.rows.map((r: any) => r.id).concat(chart.rows.slice(0, 10).map((r: any) => r.id)) });
await check('keywords add', 'POST', '/api/keywords', { phrases: ['note taking'], group: 'smoke' });
await check('import kinds', 'GET', '/api/imports/kinds');
const csv = 'platform,store_id,title,publisher\nandroid,com.example.one,Example One,Ex Co\nios,123,Bad Id,Ex\nandroid,com.example.one,Example One,Ex Co\n';
const pv = await check('import preview', 'POST', '/api/imports/preview', { kind: 'listings', format: 'csv', content: csv });
console.log(`     preview totals ${JSON.stringify(pv.totals)}`);
await check('import commit', 'POST', '/api/imports/commit', { kind: 'listings', format: 'csv', content: csv, filename: 'smoke.csv' });
const ids = chart.rows.slice(0, 3).map((r: any) => r.id);
await check('compare', 'POST', '/api/compare', { ids, from: '2020-01-01', to: meta.today });
const exp = await check('compare csv', 'POST', '/api/compare/export', { ids, from: '2020-01-01', to: meta.today, format: 'csv' });
console.log(`     csv lines: ${String(exp).split('\n').length}`);
await check('brief', 'POST', '/api/brief', { ids });
await check('coverage', 'GET', '/api/coverage');
await check('runs', 'GET', '/api/runs');
await check('taxonomy', 'GET', '/api/taxonomy');
await check('links', 'GET', '/api/links');
await check('suggest links', 'POST', '/api/links/suggest', {});
await check('public preview', 'GET', '/api/public-preview');
await check('market patch', 'PATCH', '/api/markets/gb', { enabled: false });
const idx = await app.inject({ method: 'GET', url: '/', headers: { host: '127.0.0.1:5174' } });
console.log(`${idx.statusCode === 200 ? 'INFO' : 'INFO'} GET / -> ${idx.statusCode} (${idx.statusCode === 200 ? 'UI build served' : 'run npm run build to serve the UI'})`);
await app.close();
console.log(fails ? `\n${fails} check(s) failed` : '\nAll API smoke checks passed');
process.exitCode = fails ? 1 : 0;
