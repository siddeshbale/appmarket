// Local in-app alerts for watchlisted listings. Generated only from comparable verified data; deduplicated by key.
import { addDays, isComparable, movementFor } from '../../shared/ranks';
import { all, nowIso, type Db } from '../db';
import { loadScopeSnapshots, scopeId, type Scope } from '../repo/query';

export function generateAlerts(db: Db, threshold: number, runId: number | null): number {
  const watched = all<{ listing_id: number }>(db, 'SELECT DISTINCT listing_id FROM watchlist_items');
  if (!watched.length) return 0;
  const ins = db.prepare('INSERT OR IGNORE INTO alerts (listing_id, run_id, type, dedupe_key, message, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  let created = 0;
  const add = (listingId: number, type: string, key: string, message: string, evidence: unknown) => {
    const r = ins.run(listingId, runId, type, key, message, JSON.stringify(evidence), nowIso());
    created += Number(r.changes);
  };
  for (const { listing_id: id } of watched) {
    const title = (db.prepare('SELECT title FROM listings WHERE id = ?').get(id) as any)?.title ?? `#${id}`;
    // chart events per scope, using each scope's latest comparable day
    const scopes = all<any>(
      db,
      `SELECT DISTINCT s.provider, s.provenance, s.platform, s.market, s.device, s.chart_type, s.category, s.category_scope
       FROM chart_entries e JOIN chart_snapshots s ON s.id = e.snapshot_id WHERE e.listing_id = ? AND s.provenance IN ('observed','demo')`,
      [id],
    );
    for (const r of scopes) {
      const s: Scope = { provider: r.provider, provenance: r.provenance, platform: r.platform, market: r.market, device: r.device, chartType: r.chart_type, category: r.category, categoryScope: r.category_scope };
      const latest = (db.prepare(
        `SELECT MAX(snapshot_day) AS d FROM chart_snapshots WHERE provider=? AND provenance=? AND platform=? AND market=? AND device=? AND chart_type=? AND category=? AND category_scope=? AND status IN ('complete','partial')`,
      ).get(s.provider, s.provenance, s.platform, s.market, s.device, s.chartType, s.category, s.categoryScope) as any)?.d;
      if (!latest) continue;
      const snaps = loadScopeSnapshots(db, s, addDays(latest, -60), latest);
      const cur = snaps.find((x) => x.day === latest);
      const prev = [...snaps].reverse().find((x) => x.day < latest && isComparable(x));
      if (!cur || !prev || !cur.ranks.has(id)) continue;
      const m = movementFor(id, snaps, latest, Math.round((Date.parse(latest) - Date.parse(prev.day)) / 86400000), 0);
      const sid = scopeId(s);
      const ev = { scopeId: sid, day: latest, comparedDay: prev.day, currentRank: m.currentRank, previousRank: m.previousRank, depth: cur.observedDepth, comparedDepth: prev.observedDepth };
      if (m.kind === 'new_first_observed' || m.kind === 'reentry') {
        add(id, 'new_chart_entry', `entry|${id}|${sid}|${latest}`, `${title} entered ${describe(s)} at #${m.currentRank} (${m.kind === 'reentry' ? 're-entry' : 'first observed'})`, ev);
      } else if (m.delta !== null && Math.abs(m.delta) >= threshold) {
        add(id, 'rank_move', `move|${id}|${sid}|${latest}`, `${title} moved ${m.delta > 0 ? 'up' : 'down'} ${Math.abs(m.delta)} in ${describe(s)}: #${m.previousRank} → #${m.currentRank}`, ev);
      }
    }
    // observation changes: compare the two latest observations per market/provider (observed or demo provenance only)
    const groups = all<any>(db, "SELECT DISTINCT market, provider, provenance FROM listing_observations WHERE listing_id = ? AND provenance IN ('observed','demo') AND availability='available'", [id]);
    for (const g of groups) {
      const two = all<any>(
        db,
        "SELECT id, snapshot_day, price, currency, version, store_updated_at, source_url FROM listing_observations WHERE listing_id = ? AND market = ? AND provider = ? AND provenance = ? AND availability='available' ORDER BY snapshot_day DESC LIMIT 2",
        [id, g.market, g.provider, g.provenance],
      );
      if (two.length < 2) continue;
      const [a, b] = two;
      if (a.price !== null && b.price !== null && (a.price !== b.price || a.currency !== b.currency)) {
        add(id, 'price_change', `price|${id}|${g.market}|${g.provider}|${a.snapshot_day}`, `${title} price in ${g.market.toUpperCase()}: ${b.price} ${b.currency ?? ''} → ${a.price} ${a.currency ?? ''}`, {
          market: g.market, provider: g.provider, before: { day: b.snapshot_day, price: b.price, currency: b.currency }, after: { day: a.snapshot_day, price: a.price, currency: a.currency }, source: a.source_url,
        });
      }
      const verChanged = a.version && b.version && a.version !== b.version;
      const dateChanged = !verChanged && a.store_updated_at && b.store_updated_at && a.store_updated_at !== b.store_updated_at;
      if (verChanged || dateChanged) {
        add(id, 'update', `update|${id}|${g.market}|${g.provider}|${a.version ?? a.store_updated_at}`, `${title} updated${verChanged ? `: v${b.version} → v${a.version}` : ` (store date ${String(a.store_updated_at).slice(0, 10)})`}`, {
          market: g.market, provider: g.provider, before: { day: b.snapshot_day, version: b.version, updated: b.store_updated_at }, after: { day: a.snapshot_day, version: a.version, updated: a.store_updated_at }, source: a.source_url,
        });
      }
    }
  }
  return created;
}

function describe(s: Scope) {
  return `${s.platform === 'ios' ? 'App Store' : 'Google Play'} ${s.market.toUpperCase()} ${s.device} top ${s.chartType}${s.category === 'all' ? '' : ` (category ${s.category})`}`;
}
