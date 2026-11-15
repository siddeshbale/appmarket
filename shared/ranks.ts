// Pure rank analytics. All comparisons happen inside ONE chart scope
// (same store, market, device, chart type and category). Callers must never mix scopes.

import type { ChartPresence, MovementKind, SnapshotStatus } from './types';

export interface ScopeSnapshot {
  day: string; // provider snapshot day, YYYY-MM-DD
  status: SnapshotStatus;
  observedDepth: number;
  /** listingId -> rank (ties allowed for imported data) */
  ranks: Map<number, number>;
}

export interface RankPoint {
  day: string;
  rank: number | null;
  presence: ChartPresence;
  depth: number | null;
}

/** Usable for comparisons: fetched and holding entries. Failed/empty snapshots are never used to infer absence. */
export function isComparable(s: ScopeSnapshot | undefined): s is ScopeSnapshot {
  return !!s && (s.status === 'complete' || s.status === 'partial') && s.observedDepth > 0;
}

export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end && out.length < 3700) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Daily series with explicit gaps. Blank stays blank: no interpolation. */
export function rankSeries(listingId: number, snapshots: ScopeSnapshot[], days: string[]): RankPoint[] {
  const byDay = new Map(snapshots.map((s) => [s.day, s]));
  return days.map((day) => {
    const s = byDay.get(day);
    if (!s) return { day, rank: null, presence: 'no_data', depth: null };
    if (!isComparable(s)) return { day, rank: null, presence: 'failed', depth: null };
    const r = s.ranks.get(listingId);
    if (r !== undefined) return { day, rank: r, presence: 'ranked', depth: s.observedDepth };
    return { day, rank: null, presence: 'absent', depth: s.observedDepth };
  });
}

export interface Movement {
  listingId: number;
  kind: MovementKind;
  currentRank: number | null;
  previousRank: number | null;
  /** positive = moved up (towards rank 1) */
  delta: number | null;
  comparedDay: string | null;
  explanation: string;
}

/**
 * Compare a listing's rank in `current` to the comparable snapshot closest to `windowDays` earlier
 * (searching up to `toleranceDays` further back). If no comparable snapshot exists, movement is
 * 'insufficient' — we never manufacture a delta.
 */
export function movementFor(
  listingId: number,
  snapshots: ScopeSnapshot[],
  currentDay: string,
  windowDays: number,
  toleranceDays = 2,
): Movement {
  const byDay = new Map(snapshots.map((s) => [s.day, s]));
  const current = byDay.get(currentDay);
  const base = { listingId, currentRank: null, previousRank: null, delta: null, comparedDay: null } as const;
  if (!isComparable(current)) return { ...base, kind: 'insufficient', explanation: 'No usable chart on the selected day.' };
  const cur = current.ranks.get(listingId) ?? null;
  let prev: ScopeSnapshot | undefined;
  for (let k = 0; k <= toleranceDays; k++) {
    const cand = byDay.get(addDays(currentDay, -(windowDays + k)));
    if (isComparable(cand)) {
      prev = cand;
      break;
    }
  }
  if (!prev) {
    return { ...base, currentRank: cur, kind: 'insufficient', explanation: `No comparable chart ${windowDays}–${windowDays + toleranceDays} days earlier.` };
  }
  const pr = prev.ranks.get(listingId) ?? null;
  if (cur === null) {
    return {
      ...base,
      previousRank: pr,
      comparedDay: prev.day,
      kind: 'insufficient',
      explanation: pr === null ? 'Not ranked on either day.' : `Ranked #${pr} on ${prev.day}; outside the observed top ${current.observedDepth} now.`,
    };
  }
  if (pr === null) {
    const seenBefore = snapshots.some((s) => s.day < currentDay && isComparable(s) && s.ranks.has(listingId));
    return {
      ...base,
      currentRank: cur,
      comparedDay: prev.day,
      kind: seenBefore ? 'reentry' : 'new_first_observed',
      explanation: seenBefore
        ? `Re-entered at #${cur}; was outside the observed top ${prev.observedDepth} on ${prev.day}.`
        : `First observed in this chart at #${cur} (not in the observed top ${prev.observedDepth} on ${prev.day}).`,
    };
  }
  const delta = pr - cur;
  return {
    ...base,
    currentRank: cur,
    previousRank: pr,
    delta,
    comparedDay: prev.day,
    kind: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same',
    explanation: delta === 0 ? `Unchanged at #${cur} since ${prev.day}.` : `#${pr} on ${prev.day} → #${cur} (${delta > 0 ? '+' : ''}${delta}).`,
  };
}

/** Entries that were not in the previous comparable chart (new-to-chart is NOT the same as newly released). */
export function newToChart(snapshots: ScopeSnapshot[], currentDay: string): Movement[] {
  const sorted = [...snapshots].filter(isComparable).sort((a, b) => a.day.localeCompare(b.day));
  const cur = sorted.find((s) => s.day === currentDay);
  if (!cur) return [];
  const prev = [...sorted].reverse().find((s) => s.day < currentDay);
  if (!prev) return [];
  const out: Movement[] = [];
  for (const [id, rank] of cur.ranks) {
    if (prev.ranks.has(id)) continue;
    const seenBefore = sorted.some((s) => s.day < prev.day && s.ranks.has(id));
    out.push({
      listingId: id,
      kind: seenBefore ? 'reentry' : 'new_first_observed',
      currentRank: rank,
      previousRank: null,
      delta: null,
      comparedDay: prev.day,
      explanation: seenBefore ? `Re-entry vs ${prev.day} (top ${prev.observedDepth} observed).` : `Not in the observed top ${prev.observedDepth} on ${prev.day}; first observation in this chart.`,
    });
  }
  return out.sort((a, b) => (a.currentRank ?? 1e9) - (b.currentRank ?? 1e9));
}

/** Sort by rank ascending; ties broken by a stable secondary key. */
export function sortByRank<T extends { rank: number | null }>(rows: T[], tiebreak: (t: T) => string): T[] {
  return [...rows].sort((a, b) => {
    const ra = a.rank ?? Number.POSITIVE_INFINITY;
    const rb = b.rank ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return tiebreak(a).localeCompare(tiebreak(b));
  });
}
