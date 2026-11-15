// Demo seed: clearly FICTIONAL records for exercising every view. Written only to the demo database
// with provenance 'demo'. Never run against the live database.
import { addDays } from '../../shared/ranks';
import { nowIso, run, tx, type Db } from '../db';
import { generateAlerts } from '../ingest/alerts';
import type { ChartNorm, ListingNorm } from '../providers/types';
import { storeChart, storeListingObservation } from '../repo/store';

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PUBS = ['Northwind Labs (Fictional)', 'Pebble & Pine (Fictional)', 'Quartz Owl Studio (Fictional)', 'Saffron Bay Apps (Fictional)', 'Tiny Comet Games (Fictional)', 'Blue Lantern Co (Fictional)'];
const APPS: { title: string; pub: number; ios: string; android: string; cat: [string, string]; andCat: string; game: boolean; price: number }[] = [];
const WORDS = ['Lumen', 'Nimbus', 'Orbit', 'Pocket', 'Quill', 'Ripple', 'Sprout', 'Tidal', 'Umbra', 'Vista', 'Willow', 'Zephyr', 'Ember', 'Fable', 'Grove', 'Harbor', 'Iris', 'Juniper', 'Kite', 'Lark'];
const APP_NOUNS: [string, string, string, string][] = [
  ['Notes', '6007', 'Productivity', 'PRODUCTIVITY'], ['Budget', '6015', 'Finance', 'FINANCE'], ['Fit', '6013', 'Health & Fitness', 'HEALTH_AND_FITNESS'],
  ['Photo', '6008', 'Photo & Video', 'PHOTOGRAPHY'], ['Chat', '6005', 'Social Networking', 'SOCIAL'], ['Learn', '6017', 'Education', 'EDUCATION'],
  ['Weather', '6001', 'Weather', 'WEATHER'], ['Shop', '6024', 'Shopping', 'SHOPPING'],
];
const GAME_NOUNS: [string, string, string, string][] = [
  ['Puzzle Quest', '7012', 'Puzzle', 'GAME_PUZZLE'], ['Drift Racer', '7013', 'Racing', 'GAME_RACING'], ['Kingdoms', '7017', 'Strategy', 'GAME_STRATEGY'],
  ['Word Garden', '7019', 'Word', 'GAME_WORD'], ['Tap Hero', '7003', 'Casual', 'GAME_CASUAL'],
];

function buildCatalog() {
  if (APPS.length) return APPS;
  for (let i = 0; i < 20; i++) {
    const game = i % 3 === 2;
    const noun = game ? GAME_NOUNS[i % GAME_NOUNS.length] : APP_NOUNS[i % APP_NOUNS.length];
    const title = `${WORDS[i]} ${noun[0]}`;
    APPS.push({
      title, pub: i % PUBS.length, ios: String(900000100 + i), android: `demo.fictional.${WORDS[i].toLowerCase()}${noun[0].toLowerCase().replace(/\s/g, '')}`,
      cat: [noun[1], noun[2]], andCat: noun[3], game, price: i === 7 ? 2.99 : i === 13 ? 4.99 : 0,
    });
  }
  return APPS;
}

export function seedDemo(db: Db, opts: { days?: number; today?: string } = {}) {
  const days = opts.days ?? 45;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const rnd = prng(42);
  const apps = buildCatalog();
  return tx(db, () => {
    const scopes: { market: string; device: 'iphone' | 'android_phone'; platform: 'ios' | 'android'; chartType: 'free' | 'grossing' | 'paid'; category: string; scope: 'all' | 'category'; depth: number; pool: number[] }[] = [
      { market: 'us', device: 'iphone', platform: 'ios', chartType: 'free', category: 'all', scope: 'all', depth: 15, pool: apps.map((_, i) => i).filter((i) => apps[i].price === 0) },
      { market: 'us', device: 'iphone', platform: 'ios', chartType: 'grossing', category: 'all', scope: 'all', depth: 12, pool: apps.map((_, i) => i) },
      { market: 'us', device: 'iphone', platform: 'ios', chartType: 'free', category: '6014', scope: 'category', depth: 6, pool: apps.map((_, i) => i).filter((i) => apps[i].game) },
      { market: 'in', device: 'iphone', platform: 'ios', chartType: 'free', category: 'all', scope: 'all', depth: 15, pool: apps.map((_, i) => i).filter((i) => apps[i].price === 0).reverse() },
      { market: 'us', device: 'android_phone', platform: 'android', chartType: 'free', category: 'all', scope: 'all', depth: 12, pool: apps.map((_, i) => i).filter((i) => apps[i].price === 0 && i % 4 !== 3) },
    ];
    const strength = apps.map(() => rnd() * 10);
    for (let d = days - 1; d >= 0; d--) {
      const day = addDays(today, -d);
      apps.forEach((_, i) => (strength[i] += (rnd() - 0.5) * 1.6 + (i === 4 && d < 10 ? 0.9 : 0) - (i === 9 && d < 12 ? 0.8 : 0)));
      for (const sc of scopes) {
        // deliberate gaps: one missing day in every scope; one failed fetch for the IN chart
        if (d === 9) continue;
        if (sc.market === 'in' && d === 3) {
          run(db, `INSERT INTO chart_snapshots (provider, provenance, platform, market, device, chart_type, category, category_scope, snapshot_day, fetched_at, requested_depth, observed_depth, status, source_url, error_class)
                   VALUES ('demo-feed','demo','ios','in','iphone','free','all','all',?,?,15,0,'failed','demo://fictional','server_error')`, [day, day + 'T06:00:00.000Z']);
          continue;
        }
        const ranked = [...sc.pool].sort((a, b) => strength[b] - strength[a]).slice(0, sc.depth);
        // app 11 is released mid-period: absent before, enters later ("new to chart" and "newly released" both, at different times)
        const filtered = ranked.filter((i) => !(i === 11 && d > 20));
        const chart: ChartNorm = {
          provider: 'demo-feed', platform: sc.platform, market: sc.market, device: sc.device, chartType: sc.chartType, category: sc.category, categoryScope: sc.scope,
          requestedDepth: sc.depth, snapshotDay: day, fetchedAt: day + 'T06:00:00.000Z', sourceUrl: 'demo://fictional',
          entries: filtered.map((i, k) => ({
            rank: k + 1, storeId: sc.platform === 'ios' ? apps[i].ios : apps[i].android, title: apps[i].title, publisherName: PUBS[apps[i].pub], publisherStoreId: sc.platform === 'ios' ? String(800000000 + apps[i].pub) : null,
            publisherUrl: null, categoryId: sc.platform === 'ios' ? apps[i].cat[0] : apps[i].andCat, categoryName: sc.platform === 'ios' ? apps[i].cat[1] : null,
            price: apps[i].price, currency: sc.market === 'in' ? 'INR' : 'USD', releaseDate: i === 11 ? addDays(today, -20) : addDays(today, -400 - i * 37), iconUrl: null, url: null,
            bundleId: sc.platform === 'ios' ? `demo.fictional.${apps[i].title.toLowerCase().replace(/\s/g, '')}.ios` : null,
          })),
        };
        storeChart(db, chart, { provenance: 'demo' });
      }
      // weekly metadata observations
      if (d % 7 === 0 || d === 1) {
        apps.forEach((a, i) => {
          for (const [platform, market] of [['ios', 'us'], ['ios', 'in'], ['android', 'us']] as const) {
            if (platform === 'android' && i % 4 === 3) continue;
            const base = 1000 + i * 3500;
            const n: ListingNorm = {
              platform, storeId: platform === 'ios' ? a.ios : a.android, market, language: 'en', availability: 'available', title: a.title,
              description: `${a.title} is a fictional demo listing. ${a.game ? 'Play relaxing levels, daily challenges and offline puzzles.' : 'Organize daily tasks, track habits and sync across devices.'} Free trial available.`,
              publisherName: PUBS[a.pub], publisherStoreId: platform === 'ios' ? String(800000000 + a.pub) : null, publisherUrl: null,
              categoryId: platform === 'ios' ? a.cat[0] : a.andCat, categoryName: platform === 'ios' ? a.cat[1] : null, isGame: a.game,
              price: market === 'in' ? Math.round(a.price * 83) : i === 7 && d < 14 ? 1.99 : a.price, currency: market === 'in' ? 'INR' : 'USD',
              rating: Math.round((3.6 + (i % 7) * 0.2 + rnd() * 0.05) * 100) / 100, ratingCount: Math.round(base * (1 + (days - d) / 40) * (market === 'in' ? 0.4 : 1)), ratingScope: 'demo (fictional)',
              version: `${1 + (i % 4)}.${Math.floor((days - d) / 14)}.0`, storeUpdatedAt: addDays(today, -d - (i % 5)) + 'T00:00:00.000Z', releaseDate: i === 11 ? addDays(today, -20) : addDays(today, -400 - i * 37),
              iconUrl: null, installBand: platform === 'android' ? ['10K+', '100K+', '1M+', '5M+', '10M+'][i % 5] : null, installLowerBound: platform === 'android' ? [1e4, 1e5, 1e6, 5e6, 1e7][i % 5] : null,
              hasAds: platform === 'android' ? i % 2 === 0 : null, hasIap: platform === 'android' ? true : null, contentRating: 'Everyone', sourceUrl: 'demo://fictional',
              bundleId: platform === 'ios' ? `demo.fictional.${a.title.toLowerCase().replace(/\s/g, '')}.ios` : a.android,
            };
            if (i === 11 && d > 20) continue;
            storeListingObservation(db, n, { provider: 'demo-feed', provenance: 'demo', snapshotDay: day, observedAt: day + 'T06:30:00.000Z' });
          }
        });
      }
    }
    // An imported Android category chart with a tie, labeled User-supplied
    const imp = run(db, "INSERT INTO imports (kind, filename, source_label, created_at, rows_total, rows_ok, rows_bad, rows_duplicate, summary_json, is_private) VALUES ('chart_snapshots','demo-android-games.csv','Demo manual observation (fictional)',?,4,4,0,0,'{}',0)", [nowIso()]);
    const importId = Number(imp.lastInsertRowid);
    const games = apps.filter((a) => a.game);
    for (const [k, dd] of [[0, 2], [1, 1]] as const) {
      storeChart(db, {
        provider: 'import', platform: 'android', market: 'us', device: 'android_phone', chartType: 'free', category: 'GAME_PUZZLE', categoryScope: 'category', requestedDepth: 3,
        snapshotDay: addDays(today, -dd), fetchedAt: nowIso(), sourceUrl: 'import:demo',
        entries: games.slice(k, k + 3).map((a, j) => ({ rank: j === 2 ? 2 : j + 1, storeId: a.android, title: a.title, publisherName: PUBS[a.pub], publisherStoreId: null, publisherUrl: null, categoryId: null, categoryName: null, price: null, currency: null, releaseDate: null, iconUrl: null, url: null })),
      }, { provenance: 'imported', importId });
    }
    // Watchlists, evidence, teardowns, keywords, links, notes
    const lid = (platform: string, sid: string) => (db.prepare('SELECT id FROM listings WHERE platform = ? AND store_id = ?').get(platform, sid) as any).id as number;
    const wl = Number(run(db, "INSERT INTO watchlists (name, notes, tags, created_at) VALUES ('Productivity rivals (demo)', 'Fictional demo watchlist', 'demo,productivity', ?)", [nowIso()]).lastInsertRowid);
    const wl2 = Number(run(db, "INSERT INTO watchlists (name, notes, tags, created_at) VALUES ('Puzzle games (demo)', 'Fictional demo watchlist', 'demo,games', ?)", [nowIso()]).lastInsertRowid);
    for (const i of [0, 4, 7, 9, 12]) run(db, 'INSERT INTO watchlist_items (watchlist_id, listing_id, notes, added_at) VALUES (?, ?, ?, ?)', [wl, lid('ios', apps[i].ios), null, nowIso()]);
    for (const a of games.slice(0, 3)) run(db, 'INSERT INTO watchlist_items (watchlist_id, listing_id, notes, added_at) VALUES (?, ?, ?, ?)', [wl2, lid('android', a.android), null, nowIso()]);
    run(db, 'UPDATE listings SET tracked = 1 WHERE id IN (SELECT listing_id FROM watchlist_items)');
    const ev = db.prepare(`INSERT INTO evidence (kind, listing_id, channel, market, advertiser, creator, hook, format, url, first_observed, last_observed, metrics_json, tags, notes, is_public, provenance, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo', ?)`);
    ev.run('paid_ad', lid('ios', apps[0].ios), 'meta', 'us', PUBS[apps[0].pub], null, '"Stop losing ideas" — split-screen before/after', 'video 9:16', 'https://example.com/demo-ad-1', addDays(today, -20), addDays(today, -2), JSON.stringify([{ label: 'Impressions (range shown by source)', value: '10K–50K', scope: 'US, demo' }]), 'demo,ugc-style', 'Fictional example', 1, nowIso());
    ev.run('organic_post', lid('ios', apps[4].ios), 'tiktok', 'us', null, '@demo_creator', 'Day-in-the-life using the app', 'video', 'https://example.com/demo-post', addDays(today, -12), null, '[]', 'demo,organic', 'Fictional example', 0, nowIso());
    ev.run('sponsorship_unverified', lid('ios', apps[9].ios), 'youtube', 'in', null, 'Demo Channel', 'Mid-roll mention, no #ad disclosure visible', 'integration', 'https://example.com/demo-video', addDays(today, -6), null, '[]', 'demo,unverified', 'Sponsorship not confirmed', 0, nowIso());
    run(db, `INSERT INTO onboarding_teardowns (listing_id, version_label, observed_at, market, device, first_meaningful_action, steps_to_value, signup_friction, paywall_timing, permissions, pricing, trial_terms, notes, provenance, created_at)
             VALUES (?, 'v1.2', ?, 'us', 'iPhone (demo)', 'Create first note', 3, 'Apple/Google sign-in or email; skippable', 'After 3rd screen (hard paywall with close button)', 'Notifications at step 4', '$4.99/mo or $29.99/yr (demo)', '7-day free trial on annual plan', 'Fictional teardown', 'demo', ?)`, [lid('ios', apps[0].ios), addDays(today, -15), nowIso()]);
    run(db, `INSERT INTO onboarding_teardowns (listing_id, version_label, observed_at, market, device, first_meaningful_action, steps_to_value, signup_friction, paywall_timing, permissions, pricing, trial_terms, notes, provenance, created_at)
             VALUES (?, 'v1.3', ?, 'us', 'iPhone (demo)', 'Create first note', 2, 'Sign-in deferred until sync', 'Soft paywall after first note', 'Notifications deferred', '$4.99/mo or $34.99/yr (demo)', '3-day free trial', 'Fictional teardown — later version', 'demo', ?)`, [lid('ios', apps[0].ios), addDays(today, -2), nowIso()]);
    for (const p of ['habit tracker', 'daily planner', 'offline puzzles', 'budget app']) run(db, "INSERT INTO keywords (phrase, group_name, platform, market, provenance, created_at) VALUES (?, 'demo group', 'ios', 'us', 'demo', ?)", [p, nowIso()]);
    // a verified link and a suggestion
    const [a0, b0] = [lid('ios', apps[0].ios), lid('android', apps[0].android)].sort((x, y) => x - y);
    run(db, "INSERT INTO listing_links (listing_a, listing_b, status, evidence_json, created_at, reviewed_at) VALUES (?, ?, 'verified', ?, ?, ?)", [a0, b0, JSON.stringify([{ signal: 'manual', detail: 'Demo: verified via developer website links (fictional)', strength: 'strong' }]), nowIso(), nowIso()]);
    run(db, 'INSERT INTO private_notes (listing_id, body, tags, created_at) VALUES (?, ?, ?, ?)', [lid('ios', apps[0].ios), 'Demo private note: this never appears in the public export.', 'demo', nowIso()]);
    const alerts = generateAlerts(db, 3, null);
    return { apps: apps.length, days, alerts };
  });
}
