import { describe, expect, it } from 'vitest';
import { movementFor, newToChart, rankSeries, sortByRank, type ScopeSnapshot } from '../shared/ranks';

const snap = (day: string, ranks: [number, number][], status: ScopeSnapshot['status'] = 'complete', depth = 10): ScopeSnapshot => ({ day, status, observedDepth: depth, ranks: new Map(ranks) });

describe('rank deltas', () => {
  const s = [snap('2026-11-01', [[1, 5], [2, 1], [3, 9]]), snap('2026-11-08', [[1, 2], [2, 1], [4, 3]])];
  it('computes up/down/same within one scope', () => {
    expect(movementFor(1, s, '2026-11-08', 7)).toMatchObject({ kind: 'up', delta: 3, previousRank: 5, currentRank: 2 });
    expect(movementFor(2, s, '2026-11-08', 7)).toMatchObject({ kind: 'same', delta: 0 });
  });
  it('distinguishes first observed vs re-entry', () => {
    expect(movementFor(4, s, '2026-11-08', 7).kind).toBe('new_first_observed');
    const s2 = [snap('2026-10-20', [[4, 7]]), ...s];
    expect(movementFor(4, s2, '2026-11-08', 7).kind).toBe('reentry');
  });
  it('reports insufficient history instead of a fabricated delta', () => {
    expect(movementFor(1, s, '2026-11-08', 30)).toMatchObject({ kind: 'insufficient', delta: null });
    expect(movementFor(1, [snap('2026-11-08', [[1, 2]])], '2026-11-08', 7).kind).toBe('insufficient');
  });
  it('uses tolerance when the exact comparison day is missing, never a failed snapshot', () => {
    const t = [snap('2026-10-30', [[1, 8]]), snap('2026-11-01', [], 'failed', 0), snap('2026-11-08', [[1, 2]])];
    const m = movementFor(1, t, '2026-11-08', 7, 2);
    expect(m.comparedDay).toBe('2026-10-30');
    expect(m.delta).toBe(6);
  });
  it('handles tied ranks deterministically', () => {
    const tie = [snap('2026-11-01', [[1, 3], [2, 3]]), snap('2026-11-02', [[1, 2], [2, 3]])];
    expect(movementFor(1, tie, '2026-11-02', 1, 0).delta).toBe(1);
    expect(movementFor(2, tie, '2026-11-02', 1, 0).delta).toBe(0);
    const sorted = sortByRank([{ rank: 3, t: 'b' }, { rank: 3, t: 'a' }, { rank: null, t: 'z' }, { rank: 1, t: 'c' }], (x) => x.t);
    expect(sorted.map((x) => x.t)).toEqual(['c', 'a', 'b', 'z']);
  });
});

describe('chart gaps and drop-outs', () => {
  it('keeps no-data days blank and marks absence only where a chart was fetched', () => {
    const s = [snap('2026-11-01', [[1, 4]]), snap('2026-11-03', [[2, 1]]), snap('2026-11-04', [], 'failed', 0)];
    const series = rankSeries(1, s, ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
    expect(series.map((p) => [p.rank, p.presence])).toEqual([
      [4, 'ranked'],
      [null, 'no_data'],
      [null, 'absent'],
      [null, 'failed'],
    ]);
  });
  it('lists new-to-chart only against the previous comparable snapshot', () => {
    const s = [snap('2026-11-01', [[1, 1]]), snap('2026-11-02', [], 'failed', 0), snap('2026-11-03', [[1, 1], [2, 2]])];
    const n = newToChart(s, '2026-11-03');
    expect(n.map((m) => [m.listingId, m.comparedDay])).toEqual([[2, '2026-11-01']]);
  });
});
