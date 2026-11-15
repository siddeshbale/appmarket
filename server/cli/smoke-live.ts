// Live smoke checks: small real requests per provider × market. Records validation results in the database
// (settings validation:<provider>) — never chart or listing data.
//   npm run smoke:live                     (markets us,in,gb,jp)
//   npm run smoke:live -- --markets us --android-package com.example.app
import { loadConfig } from '../config';
import { migrate, nowIso, openDb, setSetting } from '../db';
import { PoliteClient } from '../http/client';
import { fetchLegacyChart, fetchV2Chart, lookupApple, searchApple } from '../providers/apple';
import { fetchPlayDetails } from '../providers/googlePlay';
import { list, parseArgs } from './args';

const f = parseArgs();
const cfg = loadConfig();
const db = openDb(cfg.dbPath);
migrate(db);
const markets = list(f.markets) ?? ['us', 'in', 'gb', 'jp'];
const pkg = typeof f['android-package'] === 'string' ? f['android-package'] : 'com.whatsapp';
const appleId = typeof f['apple-id'] === 'string' ? f['apple-id'] : '284882215';
const mk = (provider: string, interval: number) =>
  new PoliteClient({ provider, budget: 40, minIntervalMs: interval, timeoutMs: cfg.httpTimeoutMs, maxRetries: 2, maxConcurrency: 1, cacheTtlMin: 0, acceptLanguage: 'en-US,en;q=0.8' }, db, () => {});
const results: Record<string, Record<string, { ok: boolean; detail: string; at: string }>> = {};
const rec = (p: string, m: string, ok: boolean, detail: string) => {
  (results[p] ??= {})[m] = { ok, detail, at: nowIso() };
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${p.padEnd(22)} ${m.padEnd(16)} ${detail}`);
};
const legacy = mk('apple-itunes-rss', 1500);
const v2 = mk('apple-rss-v2', 1500);
const lk = mk('itunes-lookup', 3000);
const gp = mk('google-play-details', 4000);
for (const m of markets) {
  for (const [dev, type, genre] of [['iphone', 'free', 'all'], ['iphone', 'grossing', '6014'], ['ipad', 'paid', 'all']] as const) {
    const key = `${m}/${dev}/${type}/${genre}`;
    try {
      const c = await fetchLegacyChart(legacy, m, dev, type, genre, 10);
      const valid = c.entries.length > 0 && c.entries.every((e, i) => e.rank === i + 1 && /^\d+$/.test(e.storeId));
      rec('apple-itunes-rss', key, valid, `${c.entries.length} ranked entries, snapshot day ${c.snapshotDay}${genre !== 'all' ? `, category ids: ${[...new Set(c.entries.map((e) => e.categoryId))].slice(0, 4).join('/')}` : ''}`);
    } catch (e: any) {
      rec('apple-itunes-rss', key, false, `${e.errorClass ?? 'error'}: ${e.message}`);
    }
  }
  for (const t of ['free', 'paid'] as const) {
    try {
      const c = await fetchV2Chart(v2, m, t, 10);
      rec('apple-rss-v2', `${m}/${t}`, c.entries.length > 0, `${c.entries.length} entries, day ${c.snapshotDay}`);
    } catch (e: any) {
      rec('apple-rss-v2', `${m}/${t}`, false, `${e.errorClass ?? 'error'}: ${e.message}`);
    }
  }
  try {
    const [n] = await lookupApple(lk, [appleId], m);
    rec('itunes-lookup', `${m}/lookup`, n.availability === 'available' && !!n.title, `${n.title ?? 'unavailable'} · ${n.price} ${n.currency} · rating ${n.rating} (${n.ratingCount})`);
  } catch (e: any) {
    rec('itunes-lookup', `${m}/lookup`, false, `${e.errorClass ?? 'error'}: ${e.message}`);
  }
  try {
    const r = await searchApple(lk, 'notes', m, 5);
    rec('itunes-lookup', `${m}/search`, r.length > 0, `${r.length} results`);
  } catch (e: any) {
    rec('itunes-lookup', `${m}/search`, false, `${e.errorClass ?? 'error'}: ${e.message}`);
  }
  if (cfg.googlePlayEnabled) {
    try {
      const n = await fetchPlayDetails(gp, pkg, m, 'en');
      const ok = n.availability === 'available' && !!n.title && n.rating !== null;
      rec('google-play-details', `${m}/${pkg}`, ok, `${n.title} · ${n.installBand ?? 'no install band'} · rating ${n.rating} (${n.ratingCount}) · ${n.currency ?? '?'} · ads=${n.hasAds} iap=${n.hasIap}`);
    } catch (e: any) {
      rec('google-play-details', `${m}/${pkg}`, false, `${e.errorClass ?? 'error'}: ${e.message}`);
    }
  } else rec('google-play-details', `${m}/${pkg}`, false, 'disabled by configuration');
}
for (const [p, r] of Object.entries(results)) {
  const prev = (db.prepare('SELECT value FROM settings WHERE key = ?').get(`validation:${p}`) as any)?.value;
  const merged = { ...(prev ? JSON.parse(prev) : {}), ...r };
  setSetting(db, `validation:${p}`, merged);
}
console.log(`\nValidation recorded in ${cfg.dbPath} (settings validation:*). Charts/listings were NOT stored.`);
db.close();
