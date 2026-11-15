// Cross-store link suggestions. A suggestion needs at least two independent signals and is never
// auto-verified. Similar names alone never produce a suggestion. Ratings/ranks are never combined.
import { all, get, nowIso, run, type Db } from '../db';

export function normName(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|plc|s\.?a|pvt|private|technologies|technology|games|studio|studios)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(s: string) {
  return new Set(normName(s).split(' ').filter((t) => t.length > 1));
}
export function jaccard(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface LinkEvidence {
  signal: 'publisher_name' | 'title' | 'bundle_prefix' | 'manual';
  detail: string;
  strength: 'strong' | 'medium' | 'weak';
}

export function evidenceFor(ios: any, android: any): LinkEvidence[] {
  const ev: LinkEvidence[] = [];
  const pa = normName(ios.publisher_name);
  const pb = normName(android.publisher_name);
  if (pa && pa === pb) ev.push({ signal: 'publisher_name', detail: `Publisher names match after normalization: "${ios.publisher_name}" / "${android.publisher_name}"`, strength: 'medium' });
  const t = jaccard(ios.title, android.title);
  if (t >= 0.6) ev.push({ signal: 'title', detail: `Title token overlap ${(t * 100).toFixed(0)}%: "${ios.title}" / "${android.title}"`, strength: 'weak' });
  if (ios.bundle_id && android.store_id) {
    const a = String(ios.bundle_id).toLowerCase().split('.');
    const b = String(android.store_id).toLowerCase().split('.');
    let k = 0;
    while (k < a.length && k < b.length && a[k] === b[k]) k++;
    if (k >= 2) ev.push({ signal: 'bundle_prefix', detail: `Identifier prefix "${a.slice(0, k).join('.')}" shared by iOS bundle ${ios.bundle_id} and package ${android.store_id}`, strength: 'strong' });
  }
  return ev;
}

/**
 * A suggestion needs a title match PLUS at least one organization-level signal (publisher name or shared
 * identifier prefix). A title match alone never qualifies; an organization match alone never qualifies
 * (publishers have many apps). Suggestions still require human review.
 */
export function qualifies(ev: LinkEvidence[]): boolean {
  const kinds = new Set(ev.map((e) => e.signal));
  return kinds.has('title') && (kinds.has('publisher_name') || kinds.has('bundle_prefix'));
}

export function suggestLinks(db: Db, limit = 500): { created: number; ambiguous: number } {
  const ios = all<any>(db, `SELECT l.id, l.title, l.bundle_id, l.store_id, p.name AS publisher_name FROM listings l LEFT JOIN publishers p ON p.id = l.publisher_id WHERE l.platform = 'ios'`);
  const android = all<any>(db, `SELECT l.id, l.title, l.store_id, p.name AS publisher_name FROM listings l LEFT JOIN publishers p ON p.id = l.publisher_id WHERE l.platform = 'android'`);
  let created = 0;
  let ambiguous = 0;
  for (const a of ios) {
    const cands = android.map((b) => ({ b, ev: evidenceFor(a, b) })).filter((x) => qualifies(x.ev));
    if (!cands.length) continue;
    const isAmbiguous = cands.length > 1;
    if (isAmbiguous) ambiguous++;
    for (const { b, ev } of cands) {
      const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      const evidence = isAmbiguous ? [...ev, { signal: 'manual', detail: `Ambiguous: ${cands.length} Android candidates qualify for this iOS listing — review each.`, strength: 'weak' }] : ev;
      const r = run(db, "INSERT OR IGNORE INTO listing_links (listing_a, listing_b, status, evidence_json, created_at) VALUES (?, ?, 'suggested', ?, ?)", [x, y, JSON.stringify(evidence), nowIso()]);
      created += Number(r.changes);
      if (created >= limit) return { created, ambiguous };
    }
  }
  return { created, ambiguous };
}

export function setLinkStatus(db: Db, id: number, status: 'verified' | 'rejected') {
  const link = get<any>(db, 'SELECT * FROM listing_links WHERE id = ?', [id]);
  if (!link) return false;
  run(db, 'UPDATE listing_links SET status = ?, reviewed_at = ? WHERE id = ?', [status, nowIso(), id]);
  return true;
}

export function createManualLink(db: Db, a: number, b: number, note: string) {
  const la = get<any>(db, 'SELECT id, platform FROM listings WHERE id = ?', [a]);
  const lb = get<any>(db, 'SELECT id, platform FROM listings WHERE id = ?', [b]);
  if (!la || !lb || la.platform === lb.platform) throw new Error('A cross-store link needs one iOS and one Android listing');
  const [x, y] = a < b ? [a, b] : [b, a];
  const ev = JSON.stringify([{ signal: 'manual', detail: note.slice(0, 500) || 'Linked manually by user', strength: 'strong' }]);
  run(db, "INSERT INTO listing_links (listing_a, listing_b, status, evidence_json, created_at, reviewed_at) VALUES (?, ?, 'verified', ?, ?, ?) ON CONFLICT(listing_a, listing_b) DO UPDATE SET status='verified', evidence_json=excluded.evidence_json, reviewed_at=excluded.reviewed_at", [
    x, y, ev, nowIso(), nowIso(),
  ]);
}
