// Shared domain types used by the API, the static public build and tests.

export type Platform = 'ios' | 'android';
export type Device = 'iphone' | 'ipad' | 'unspecified' | 'android_phone';
export type ChartType = 'free' | 'paid' | 'grossing';
/** all = whole-store chart, category = a real category chart supplied by the source,
 *  filtered_subset = an all-store chart filtered locally by genre (NOT a category chart). */
export type CategoryScope = 'all' | 'category' | 'filtered_subset';
export type Provenance = 'observed' | 'user' | 'imported' | 'demo';
export type MetricLabel = 'Observed' | 'User-supplied' | 'Modeled';
export type SnapshotStatus = 'complete' | 'partial' | 'failed' | 'empty';
export type RunStatus = 'running' | 'success' | 'partial' | 'failed' | 'restricted' | 'dry_run' | 'skipped';
export type ErrorClass =
  | 'network'
  | 'timeout'
  | 'rate_limited'
  | 'restricted'
  | 'not_found'
  | 'client_error'
  | 'server_error'
  | 'malformed'
  | 'budget_exhausted'
  | 'disabled';

/** Status of a listing in a specific chart scope on a specific day. */
export type ChartPresence =
  | 'ranked' // present with a rank
  | 'absent' // comparable chart fetched, listing not in it (outside observed depth)
  | 'no_data' // no comparable chart fetched that day
  | 'failed'; // chart fetch failed that day

export type MovementKind = 'up' | 'down' | 'same' | 'new_first_observed' | 'reentry' | 'insufficient';

export interface ChartScopeKey {
  platform: Platform;
  market: string;
  device: Device;
  chartType: ChartType;
  /** store category id or 'all' */
  category: string;
  categoryScope: CategoryScope;
}

export function scopeKeyString(s: ChartScopeKey): string {
  return [s.platform, s.market, s.device, s.chartType, s.category, s.categoryScope].join('|');
}

export function metricLabelFor(p: Provenance | string | null | undefined): MetricLabel {
  if (p === 'user' || p === 'imported') return 'User-supplied';
  return 'Observed';
}
