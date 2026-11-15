// CSV/JSON imports with preview: typed columns, units, provenance, duplicate and bad-row detection.
// Imported data is always provenance 'imported' and never deduplicated against or merged into observed data.
import { parseCsv } from '../../shared/csv';
import { isAndroidPackage, isAppleId } from '../../shared/storeUrls';
import type { Platform } from '../../shared/types';
import { get, nowIso, run, tx, type Db } from '../db';
import { installLowerBound } from '../providers/googlePlay';
import type { ChartNorm, ListingNorm } from '../providers/types';
import { ensureCategory, ensurePublisher, storeChart, storeListingObservation, upsertListing } from '../repo/store';

type FieldType = 'string' | 'int' | 'number' | 'date' | 'bool' | 'enum' | 'url' | 'market' | 'platform' | 'store_id';
interface FieldSpec {
  key: string;
  type: FieldType;
  required?: boolean;
  enum?: string[];
  unit?: string;
  aliases?: string[];
  description?: string;
  max?: number;
}

export interface ImportKindSpec {
  kind: string;
  title: string;
  description: string;
  fields: FieldSpec[];
  private: boolean;
}

const common: Record<string, FieldSpec> = {
  platform: { key: 'platform', type: 'platform', required: true, description: 'ios | android' },
  store_id: { key: 'store_id', type: 'store_id', required: true, description: 'Apple numeric id or Android package', aliases: ['app_id', 'package', 'package_name', 'Package Name'] },
  market: { key: 'market', type: 'market', description: 'ISO 3166 alpha-2, lowercase', aliases: ['country', 'Country'] },
};

export const IMPORT_KINDS: ImportKindSpec[] = [
  {
    kind: 'listings',
    title: 'Listings (register apps)',
    description: 'Registers listings for tracking. Optional fields become an imported metadata observation if a market and observed_day are present.',
    private: false,
    fields: [
      common.platform, common.store_id,
      { key: 'title', type: 'string', required: true, max: 300 },
      { key: 'publisher', type: 'string', max: 300 },
      { key: 'category_id', type: 'string', max: 60, description: 'Original store category id (e.g. 6014, GAME_PUZZLE)' },
      { key: 'category_name', type: 'string', max: 120 },
      { key: 'is_game', type: 'bool' },
      { key: 'release_date', type: 'date' },
      { key: 'track', type: 'bool', description: 'Add to tracked set (default true)' },
    ],
  },
  {
    kind: 'observations',
    title: 'Metadata observations (history)',
    description: 'Per-market listing metadata over time from your own records. Stored as imported history, separate from direct observations.',
    private: false,
    fields: [
      common.platform, common.store_id, { ...common.market, required: true },
      { key: 'observed_day', type: 'date', required: true },
      { key: 'title', type: 'string', max: 300 },
      { key: 'publisher', type: 'string', max: 300 },
      { key: 'price', type: 'number', unit: 'currency units' },
      { key: 'currency', type: 'string', max: 3 },
      { key: 'rating', type: 'number', unit: 'stars 0–5', max: 5 },
      { key: 'rating_count', type: 'int', unit: 'ratings (not downloads)' },
      { key: 'install_band', type: 'string', unit: 'displayed lifetime threshold, e.g. 1M+', max: 20 },
      { key: 'version', type: 'string', max: 60 },
      { key: 'updated_at', type: 'date' },
      { key: 'has_ads', type: 'bool' },
      { key: 'has_iap', type: 'bool' },
      { key: 'source_url', type: 'url' },
      { key: 'source', type: 'string', max: 120, description: 'Where you got this (free text)' },
    ],
  },
  {
    kind: 'chart_snapshots',
    title: 'Chart snapshots',
    description: 'One row per ranked entry. Rows sharing platform/market/device/chart_type/category/snapshot_day form one snapshot. Ties are allowed.',
    private: false,
    fields: [
      common.platform, { ...common.market, required: true },
      { key: 'device', type: 'enum', required: true, enum: ['iphone', 'ipad', 'unspecified', 'android_phone'] },
      { key: 'chart_type', type: 'enum', required: true, enum: ['free', 'paid', 'grossing'] },
      { key: 'category', type: 'string', required: true, max: 60, description: '"all" or the store category id' },
      { key: 'category_scope', type: 'enum', enum: ['all', 'category', 'filtered_subset'], description: 'Defaults to all when category=all, else category' },
      { key: 'snapshot_day', type: 'date', required: true },
      { key: 'rank', type: 'int', required: true },
      common.store_id,
      { key: 'title', type: 'string', required: true, max: 300 },
      { key: 'publisher', type: 'string', max: 300 },
      { key: 'requested_depth', type: 'int', description: 'Depth of the chart you observed (defaults to max rank in the snapshot)' },
      { key: 'source', type: 'string', max: 120 },
    ],
  },
  {
    kind: 'keywords',
    title: 'Keywords (user-owned data)',
    description: 'Keyword groups and, optionally, positions/volume/difficulty from a tool or console YOU have access to. Values are labeled user-supplied with their source.',
    private: true,
    fields: [
      { key: 'phrase', type: 'string', required: true, max: 200 },
      { key: 'group', type: 'string', max: 100 },
      { key: 'platform', type: 'platform' },
      { key: 'market', type: 'market' },
      { key: 'store_id', type: 'store_id' },
      { key: 'observed_day', type: 'date' },
      { key: 'position', type: 'int', unit: 'search result position' },
      { key: 'search_volume', type: 'number' },
      { key: 'volume_unit', type: 'string', max: 60, description: 'e.g. "tool popularity index 5–100" — required when search_volume is set' },
      { key: 'difficulty', type: 'number' },
      { key: 'source', type: 'string', max: 120, description: 'Required when position/volume/difficulty is set' },
    ],
  },
  {
    kind: 'evidence',
    title: 'Ads / creative / social evidence',
    description: 'References to ads, organic posts and creator content. Store links, not copied media.',
    private: true,
    fields: [
      { key: 'kind', type: 'enum', required: true, enum: ['paid_ad', 'organic_post', 'sponsorship_unverified', 'creator', 'screenshot', 'store_page', 'other'] },
      { key: 'platform', type: 'platform' },
      { key: 'store_id', type: 'store_id' },
      { key: 'channel', type: 'string', max: 60, description: 'meta, tiktok, google, youtube, instagram, x, reddit…' },
      common.market,
      { key: 'advertiser', type: 'string', max: 200 },
      { key: 'creator', type: 'string', max: 200 },
      { key: 'hook', type: 'string', max: 500 },
      { key: 'format', type: 'string', max: 60 },
      { key: 'url', type: 'url' },
      { key: 'first_observed', type: 'date' },
      { key: 'last_observed', type: 'date' },
      { key: 'metric_label', type: 'string', max: 100, description: 'Exactly as displayed by the source, e.g. "Impressions (range)"' },
      { key: 'metric_value', type: 'string', max: 100 },
      { key: 'metric_scope', type: 'string', max: 200 },
      { key: 'tags', type: 'string', max: 300 },
      { key: 'notes', type: 'string', max: 4000 },
    ],
  },
  {
    kind: 'teardowns',
    title: 'Onboarding teardowns',
    description: 'Structured onboarding/paywall observations; multiple versions per app allowed.',
    private: true,
    fields: [
      common.platform, common.store_id,
      { key: 'version_label', type: 'string', max: 60 },
      { key: 'observed_at', type: 'date', required: true },
      common.market,
      { key: 'device', type: 'string', max: 60 },
      { key: 'first_meaningful_action', type: 'string', max: 500 },
      { key: 'steps_to_value', type: 'int' },
      { key: 'signup_friction', type: 'string', max: 500 },
      { key: 'paywall_timing', type: 'string', max: 300 },
      { key: 'permissions', type: 'string', max: 500 },
      { key: 'pricing', type: 'string', max: 500 },
      { key: 'trial_terms', type: 'string', max: 300 },
      { key: 'evidence_url', type: 'url' },
      { key: 'notes', type: 'string', max: 4000 },
    ],
  },
  {
    kind: 'first_party',
    title: 'First-party analytics (private)',
    description: 'Your own Play Console / App Store Connect exports or a canonical CSV. Never included in the public export.',
    private: true,
    fields: [
      common.platform, common.store_id,
      { key: 'day', type: 'date', required: true, aliases: ['Date', 'date'] },
      { key: 'metric', type: 'string', required: true, max: 80 },
      { key: 'value', type: 'number', required: true },
      { key: 'unit', type: 'string', max: 40 },
      common.market,
      { key: 'source', type: 'string', max: 80 },
    ],
  },
];

/** Documented header mappings for first-party exports -> canonical long format. */
export const FIRST_PARTY_PRESETS: Record<string, { title: string; idColumn: string | null; dayColumn: string; marketColumn: string | null; metrics: Record<string, { metric: string; unit: string }>; note: string }> = {
  play_console_installs: {
    title: 'Google Play Console — Statistics/installs CSV',
    idColumn: 'Package Name',
    dayColumn: 'Date',
    marketColumn: 'Country',
    metrics: {
      'Daily Device Installs': { metric: 'device_installs', unit: 'installs/day' },
      'Daily User Installs': { metric: 'user_installs', unit: 'installs/day' },
      'Daily User Uninstalls': { metric: 'user_uninstalls', unit: 'uninstalls/day' },
      'Install events': { metric: 'install_events', unit: 'events/day' },
      'Active Device Installs': { metric: 'active_device_installs', unit: 'devices' },
    },
    note: 'Column names follow Play Console statistics exports; unrecognized columns are reported, not guessed.',
  },
  app_store_connect_analytics: {
    title: 'App Store Connect — App Analytics CSV (one app per file)',
    idColumn: null,
    dayColumn: 'Date',
    marketColumn: null,
    metrics: {
      Impressions: { metric: 'impressions', unit: 'impressions/day' },
      'Product Page Views': { metric: 'product_page_views', unit: 'views/day' },
      'App Units': { metric: 'app_units', unit: 'first-time downloads/day' },
      Sessions: { metric: 'sessions', unit: 'sessions/day' },
      Proceeds: { metric: 'proceeds', unit: 'account currency/day' },
    },
    note: 'Provide platform=ios and store_id in the import options because App Analytics exports do not contain the app id.',
  },
};

export interface RowIssue {
  row: number;
  field?: string;
  message: string;
}

const MARKET = /^[a-z]{2}$/;

function coerce(spec: FieldSpec, raw: unknown): { ok: true; value: any } | { ok: false; message: string } {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return spec.required ? { ok: false, message: 'required' } : { ok: true, value: null };
  }
  const s = typeof raw === 'string' ? raw.trim() : raw;
  switch (spec.type) {
    case 'string': {
      const v = String(s);
      if (spec.max && v.length > spec.max) return { ok: false, message: `longer than ${spec.max}` };
      return { ok: true, value: v };
    }
    case 'int': {
      const n = typeof s === 'number' ? s : Number(String(s).replace(/,/g, ''));
      return Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false, message: 'not a non-negative integer' };
    }
    case 'number': {
      const n = typeof s === 'number' ? s : Number(String(s).replace(/,/g, ''));
      if (!Number.isFinite(n)) return { ok: false, message: 'not a number' };
      if (spec.max !== undefined && n > spec.max) return { ok: false, message: `greater than ${spec.max}` };
      return { ok: true, value: n };
    }
    case 'date': {
      const v = String(s);
      if (!/^\d{4}-\d{2}-\d{2}/.test(v) || !Number.isFinite(Date.parse(v.slice(0, 10)))) return { ok: false, message: 'expected YYYY-MM-DD' };
      return { ok: true, value: v.slice(0, 10) };
    }
    case 'bool': {
      const v = String(s).toLowerCase();
      if (['1', 'true', 'yes', 'y'].includes(v)) return { ok: true, value: true };
      if (['0', 'false', 'no', 'n'].includes(v)) return { ok: true, value: false };
      return { ok: false, message: 'expected true/false' };
    }
    case 'enum':
      return spec.enum!.includes(String(s)) ? { ok: true, value: String(s) } : { ok: false, message: `expected one of ${spec.enum!.join(', ')}` };
    case 'url': {
      try {
        const u = new URL(String(s));
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, message: 'only http(s) URLs' };
        return { ok: true, value: u.toString() };
      } catch {
        return { ok: false, message: 'invalid URL' };
      }
    }
    case 'market':
      return MARKET.test(String(s).toLowerCase()) ? { ok: true, value: String(s).toLowerCase() } : { ok: false, message: 'expected 2-letter country code' };
    case 'platform': {
      const v = String(s).toLowerCase();
      if (v === 'ios' || v === 'apple' || v === 'app store') return { ok: true, value: 'ios' };
      if (v === 'android' || v === 'google play' || v === 'play') return { ok: true, value: 'android' };
      return { ok: false, message: 'expected ios or android' };
    }
    case 'store_id':
      return { ok: true, value: String(s) };
  }
}

export interface ParsedImport {
  kind: string;
  header: string[];
  unknownColumns: string[];
  missingColumns: string[];
  rows: { row: number; values: Record<string, any>; issues: RowIssue[]; duplicate?: string }[];
  totals: { total: number; ok: number; bad: number; duplicate: number };
  fields: FieldSpec[];
}

function readRecords(content: string, format: 'csv' | 'json', maxRows: number): { header: string[]; rows: Record<string, any>[] } {
  if (format === 'json') {
    let j: any;
    try {
      j = JSON.parse(content);
    } catch {
      throw new Error('Invalid JSON');
    }
    const arr = Array.isArray(j) ? j : Array.isArray(j?.rows) ? j.rows : null;
    if (!arr) throw new Error('JSON must be an array of objects or {"rows": [...]}');
    if (arr.length > maxRows) throw new Error(`Too many rows (max ${maxRows})`);
    const header = Array.from(new Set(arr.flatMap((r: any) => (r && typeof r === 'object' ? Object.keys(r) : []))));
    return { header: header as string[], rows: arr.map((r: any) => (r && typeof r === 'object' ? r : {})) };
  }
  return parseCsv(content, maxRows);
}

/** Expand a first-party preset (wide) into canonical long rows. */
function applyPreset(preset: string, rows: Record<string, any>[], opts: { platform?: string; storeId?: string }) {
  const p = FIRST_PARTY_PRESETS[preset];
  if (!p) throw new Error('Unknown preset');
  const out: Record<string, any>[] = [];
  for (const r of rows) {
    for (const [col, m] of Object.entries(p.metrics)) {
      if (r[col] === undefined || r[col] === '') continue;
      out.push({
        platform: opts.platform ?? (p.idColumn === 'Package Name' ? 'android' : 'ios'),
        store_id: p.idColumn ? r[p.idColumn] : opts.storeId,
        day: r[p.dayColumn],
        metric: m.metric,
        value: r[col],
        unit: m.unit,
        market: p.marketColumn ? String(r[p.marketColumn] ?? '').toLowerCase() || null : null,
        source: p.title,
      });
    }
  }
  return out;
}

function keyFor(kind: string, v: Record<string, any>): string {
  switch (kind) {
    case 'listings':
      return `${v.platform}|${v.store_id}`;
    case 'observations':
      return `${v.platform}|${v.store_id}|${v.market}|${v.observed_day}`;
    case 'chart_snapshots':
      return `${v.platform}|${v.market}|${v.device}|${v.chart_type}|${v.category}|${v.snapshot_day}|${v.store_id}`;
    case 'keywords':
      return `${v.phrase}|${v.group ?? ''}|${v.platform ?? ''}|${v.market ?? ''}|${v.store_id ?? ''}|${v.observed_day ?? ''}`;
    case 'first_party':
      return `${v.platform}|${v.store_id}|${v.day}|${v.metric}|${v.market ?? ''}`;
    default:
      return JSON.stringify(v);
  }
}

export function parseImport(
  db: Db,
  input: { kind: string; format: 'csv' | 'json'; content: string; preset?: string; platform?: string; storeId?: string },
  maxRows = 20000,
): ParsedImport {
  const spec = IMPORT_KINDS.find((k) => k.kind === input.kind);
  if (!spec) throw new Error('Unknown import kind');
  let { header, rows } = readRecords(input.content, input.format, maxRows);
  if (input.kind === 'first_party' && input.preset) {
    const known = new Set([...Object.keys(FIRST_PARTY_PRESETS[input.preset]?.metrics ?? {}), FIRST_PARTY_PRESETS[input.preset]?.dayColumn, FIRST_PARTY_PRESETS[input.preset]?.idColumn, FIRST_PARTY_PRESETS[input.preset]?.marketColumn]);
    const unknown = header.filter((h) => !known.has(h));
    rows = applyPreset(input.preset, rows, { platform: input.platform, storeId: input.storeId });
    header = ['platform', 'store_id', 'day', 'metric', 'value', 'unit', 'market', 'source', ...unknown.map((u) => `(ignored) ${u}`)];
  }
  // alias resolution
  const resolve = (rec: Record<string, any>, f: FieldSpec) => {
    if (rec[f.key] !== undefined) return rec[f.key];
    for (const a of f.aliases ?? []) if (rec[a] !== undefined) return rec[a];
    return undefined;
  };
  const allowed = new Set(spec.fields.flatMap((f) => [f.key, ...(f.aliases ?? [])]));
  const unknownColumns = header.filter((h) => !allowed.has(h));
  const missingColumns = spec.fields.filter((f) => f.required && !header.some((h) => h === f.key || f.aliases?.includes(h))).map((f) => f.key);
  const seen = new Set<string>();
  const out: ParsedImport['rows'] = [];
  rows.forEach((rec, i) => {
    const values: Record<string, any> = {};
    const issues: RowIssue[] = [];
    for (const f of spec.fields) {
      const c = coerce(f, resolve(rec, f));
      if (c.ok) values[f.key] = c.value;
      else issues.push({ row: i + 1, field: f.key, message: c.message });
    }
    // cross-field validation
    if (values.platform && values.store_id) {
      const okId = values.platform === 'ios' ? isAppleId(values.store_id) : isAndroidPackage(values.store_id);
      if (!okId) issues.push({ row: i + 1, field: 'store_id', message: `not a valid ${values.platform} store id` });
    } else if (values.store_id && !values.platform) issues.push({ row: i + 1, field: 'platform', message: 'platform is required when store_id is set' });
    if (input.kind === 'chart_snapshots' && values.category && values.category !== 'all' && values.category_scope === 'all') issues.push({ row: i + 1, field: 'category_scope', message: 'category_scope=all requires category=all' });
    if (input.kind === 'keywords' && (values.position != null || values.search_volume != null || values.difficulty != null) && !values.source) issues.push({ row: i + 1, field: 'source', message: 'source is required for positions/volume/difficulty' });
    if (input.kind === 'keywords' && values.search_volume != null && !values.volume_unit) issues.push({ row: i + 1, field: 'volume_unit', message: 'volume_unit is required with search_volume' });
    if (input.kind === 'keywords' && values.position != null && (!values.store_id || !values.observed_day || !values.market)) issues.push({ row: i + 1, field: 'position', message: 'position needs store_id, market and observed_day' });
    let duplicate: string | undefined;
    if (!issues.length) {
      const k = keyFor(input.kind, values);
      if (seen.has(k)) duplicate = 'duplicate within file';
      else {
        seen.add(k);
        duplicate = dbDuplicate(db, input.kind, values);
      }
    }
    out.push({ row: i + 1, values, issues, duplicate });
  });
  const bad = out.filter((r) => r.issues.length).length;
  const dup = out.filter((r) => !r.issues.length && r.duplicate).length;
  return { kind: input.kind, header, unknownColumns, missingColumns, rows: out, totals: { total: out.length, ok: out.length - bad - dup, bad, duplicate: dup }, fields: spec.fields };
}

function listingIdFor(db: Db, platform: string, storeId: string): number | null {
  return get<{ id: number }>(db, 'SELECT id FROM listings WHERE platform = ? AND store_id = ?', [platform, storeId])?.id ?? null;
}

function dbDuplicate(db: Db, kind: string, v: Record<string, any>): string | undefined {
  const lid = v.platform && v.store_id ? listingIdFor(db, v.platform, v.store_id) : null;
  if (kind === 'listings' && lid) return undefined; // re-registering an existing listing just marks it tracked
  if (kind === 'observations' && lid) {
    if (get(db, "SELECT 1 FROM listing_observations WHERE listing_id = ? AND market = ? AND provider = 'import' AND provenance = 'imported' AND snapshot_day = ?", [lid, v.market, v.observed_day]))
      return 'already imported for this listing/market/day';
  }
  if (kind === 'chart_snapshots') {
    const cs = v.category_scope ?? (v.category === 'all' ? 'all' : 'category');
    if (get(db, "SELECT 1 FROM chart_snapshots WHERE provider='import' AND provenance='imported' AND platform=? AND market=? AND device=? AND chart_type=? AND category=? AND category_scope=? AND snapshot_day=?", [v.platform, v.market, v.device, v.chart_type, v.category, cs, v.snapshot_day]))
      return 'snapshot for this scope/day already imported';
  }
  if (kind === 'first_party' && lid) {
    if (get(db, 'SELECT 1 FROM first_party_metrics WHERE listing_id = ? AND day = ? AND metric = ? AND IFNULL(market, \'\') = ? ', [lid, v.day, v.metric, v.market ?? '']))
      return 'metric already imported for this day';
  }
  return undefined;
}

function emptyNorm(platform: Platform, storeId: string, market: string): ListingNorm {
  return {
    platform, storeId, market, language: null, availability: 'available', title: null, description: null, publisherName: null, publisherStoreId: null, publisherUrl: null,
    categoryId: null, categoryName: null, isGame: null, price: null, currency: null, rating: null, ratingCount: null, ratingScope: null, version: null, storeUpdatedAt: null,
    releaseDate: null, iconUrl: null, installBand: null, installLowerBound: null, hasAds: null, hasIap: null, contentRating: null, sourceUrl: '',
  };
}

export function commitImport(db: Db, parsed: ParsedImport, meta: { filename?: string | null; sourceLabel?: string | null }) {
  const spec = IMPORT_KINDS.find((k) => k.kind === parsed.kind)!;
  const good = parsed.rows.filter((r) => !r.issues.length && !r.duplicate);
  return tx(db, () => {
    const imp = run(db, 'INSERT INTO imports (kind, filename, source_label, created_at, rows_total, rows_ok, rows_bad, rows_duplicate, summary_json, is_private) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      parsed.kind, meta.filename?.slice(0, 200) ?? null, meta.sourceLabel?.slice(0, 200) ?? null, nowIso(), parsed.totals.total, good.length, parsed.totals.bad, parsed.totals.duplicate,
      JSON.stringify({ unknownColumns: parsed.unknownColumns, issues: parsed.rows.flatMap((r) => r.issues).slice(0, 200) }), spec.private ? 1 : 0,
    ]);
    const importId = Number(imp.lastInsertRowid);
    const ensureListing = (v: Record<string, any>) => {
      const id = listingIdFor(db, v.platform, v.store_id);
      if (id) return id;
      const pub = ensurePublisher(db, v.platform, null, v.publisher ?? null, null, 'imported');
      return upsertListing(db, { platform: v.platform, storeId: v.store_id, title: v.title ?? v.store_id, publisherId: pub, provenance: 'imported' });
    };
    let written = 0;
    if (parsed.kind === 'chart_snapshots') {
      const groups = new Map<string, Record<string, any>[]>();
      for (const r of good) {
        const v = r.values;
        const k = `${v.platform}|${v.market}|${v.device}|${v.chart_type}|${v.category}|${v.category_scope ?? ''}|${v.snapshot_day}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(v);
      }
      for (const rows of groups.values()) {
        const v0 = rows[0];
        const sorted = [...rows].sort((a, b) => a.rank - b.rank);
        const depth = Math.max(v0.requested_depth ?? 0, sorted[sorted.length - 1].rank);
        const chart: ChartNorm = {
          provider: 'import', platform: v0.platform, market: v0.market, device: v0.device, chartType: v0.chart_type, category: v0.category,
          categoryScope: v0.category_scope ?? (v0.category === 'all' ? 'all' : 'category'), requestedDepth: depth, snapshotDay: v0.snapshot_day, fetchedAt: nowIso(),
          sourceUrl: v0.source ? `import:${String(v0.source).slice(0, 100)}` : `import:${importId}`,
          entries: sorted.map((v) => ({
            rank: v.rank, storeId: v.store_id, title: v.title, publisherName: v.publisher ?? null, publisherStoreId: null, publisherUrl: null, categoryId: null, categoryName: null,
            price: null, currency: null, releaseDate: null, iconUrl: null, url: null,
          })),
        };
        storeChart(db, chart, { provenance: 'imported', importId });
        written += rows.length;
      }
    } else {
      for (const { values: v } of good) {
        if (parsed.kind === 'listings') {
          const pub = ensurePublisher(db, v.platform, null, v.publisher ?? null, null, 'imported');
          const cat = ensureCategory(db, v.platform, v.category_id, v.category_name, v.is_game);
          upsertListing(db, { platform: v.platform, storeId: v.store_id, title: v.title, publisherId: pub, categoryId: cat, isGame: v.is_game, releaseDate: v.release_date, provenance: 'imported', tracked: v.track !== false });
        } else if (parsed.kind === 'observations') {
          ensureListing(v);
          const n = emptyNorm(v.platform, v.store_id, v.market);
          Object.assign(n, {
            title: v.title, publisherName: v.publisher, price: v.price, currency: v.currency, rating: v.rating, ratingCount: v.rating_count, installBand: v.install_band,
            installLowerBound: null, version: v.version, storeUpdatedAt: v.updated_at, hasAds: v.has_ads, hasIap: v.has_iap, sourceUrl: v.source_url ?? (v.source ? `import:${v.source}` : `import:${importId}`),
            ratingScope: v.rating != null ? 'user-supplied' : null,
          });
          n.installLowerBound = installLowerBound(v.install_band ?? null);
          storeListingObservation(db, n, { provider: 'import', provenance: 'imported', importId, snapshotDay: v.observed_day, observedAt: v.observed_day + 'T00:00:00.000Z' });
        } else if (parsed.kind === 'keywords') {
          run(db, 'INSERT OR IGNORE INTO keywords (phrase, group_name, platform, market, provenance, import_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [v.phrase, v.group, v.platform, v.market, 'imported', importId, nowIso()]);
          const kw = get<{ id: number }>(db, 'SELECT id FROM keywords WHERE phrase = ? AND IFNULL(group_name,\'\') = IFNULL(?,\'\') AND IFNULL(platform,\'\') = IFNULL(?,\'\') AND IFNULL(market,\'\') = IFNULL(?,\'\')', [v.phrase, v.group, v.platform, v.market])!;
          if (v.position != null || v.search_volume != null || v.difficulty != null) {
            const lid = v.store_id ? ensureListing(v) : null;
            run(db, 'INSERT INTO keyword_observations (keyword_id, listing_id, observed_day, position, search_volume, volume_unit, difficulty, source, provenance, import_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
              kw.id, lid, v.observed_day ?? nowIso().slice(0, 10), v.position, v.search_volume, v.volume_unit, v.difficulty, v.source, 'imported', importId,
            ]);
          }
        } else if (parsed.kind === 'evidence') {
          const lid = v.platform && v.store_id ? ensureListing(v) : null;
          const metrics = v.metric_label ? [{ label: v.metric_label, value: v.metric_value, scope: v.metric_scope, source: v.channel }] : [];
          run(db, `INSERT INTO evidence (kind, listing_id, channel, market, advertiser, creator, hook, format, url, first_observed, last_observed, metrics_json, tags, notes, provenance, import_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?)`, [
            v.kind, lid, v.channel, v.market, v.advertiser, v.creator, v.hook, v.format, v.url, v.first_observed, v.last_observed, JSON.stringify(metrics), v.tags, v.notes, importId, nowIso(),
          ]);
        } else if (parsed.kind === 'teardowns') {
          const lid = ensureListing(v);
          run(db, `INSERT INTO onboarding_teardowns (listing_id, version_label, observed_at, market, device, first_meaningful_action, steps_to_value, signup_friction, paywall_timing, permissions, pricing, trial_terms, evidence_url, notes, provenance, import_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?)`, [
            lid, v.version_label, v.observed_at, v.market, v.device, v.first_meaningful_action, v.steps_to_value, v.signup_friction, v.paywall_timing, v.permissions, v.pricing, v.trial_terms, v.evidence_url, v.notes, importId, nowIso(),
          ]);
        } else if (parsed.kind === 'first_party') {
          const lid = ensureListing(v);
          run(db, 'INSERT OR IGNORE INTO first_party_metrics (import_id, listing_id, day, metric, value, unit, market, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
            importId, lid, v.day, v.metric, v.value, v.unit, v.market, v.source ?? 'first-party import',
          ]);
        }
        written++;
      }
    }
    return { importId, written, totals: parsed.totals };
  });
}
