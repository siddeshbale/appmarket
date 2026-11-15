// Write-side repository: normalized provider/import data -> SQLite. All SQL is prepared with bound parameters.
import type { CategoryScope, ChartType, Device, Platform, Provenance, SnapshotStatus } from '../../shared/types';
import { all, get, nowIso, run, type Db } from '../db';
import type { ChartNorm, ListingNorm } from '../providers/types';

export function ensurePublisher(db: Db, platform: Platform, storePublisherId: string | null, name: string | null, url: string | null, provenance: Provenance = 'observed'): number | null {
  if (!name && !storePublisherId) return null;
  const key = storePublisherId ?? `name:${name!.trim().toLowerCase()}`;
  const existing = get<{ id: number; name: string }>(db, 'SELECT id, name FROM publishers WHERE platform = ? AND store_publisher_id = ?', [platform, key]);
  if (existing) {
    if (name && name !== existing.name) run(db, 'UPDATE publishers SET name = ?, url = COALESCE(?, url) WHERE id = ?', [name, url, existing.id]);
    return existing.id;
  }
  const r = run(db, 'INSERT INTO publishers (platform, store_publisher_id, name, url, provenance, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    platform, key, name ?? key, url, provenance, nowIso(),
  ]);
  return Number(r.lastInsertRowid);
}

export function ensureCategory(db: Db, platform: Platform, storeCategoryId: string | null, name: string | null, isGame?: boolean | null): number | null {
  if (!storeCategoryId) return null;
  const ex = get<{ id: number; name: string }>(db, 'SELECT id, name FROM categories WHERE platform = ? AND store_category_id = ?', [platform, storeCategoryId]);
  if (ex) {
    // Keep the original store label when the source supplies one (Android JSON-LD gives ids, not labels).
    if (name && name !== storeCategoryId && name !== ex.name) run(db, 'UPDATE categories SET name = ? WHERE id = ?', [name, ex.id]);
    return ex.id;
  }
  const r = run(db, 'INSERT INTO categories (platform, store_category_id, name, is_game, unified_slug) VALUES (?, ?, ?, ?, NULL)', [
    platform, storeCategoryId, name ?? storeCategoryId, isGame ? 1 : 0,
  ]);
  return Number(r.lastInsertRowid);
}

export interface ListingUpsert {
  platform: Platform;
  storeId: string;
  title: string;
  publisherId?: number | null;
  categoryId?: number | null;
  isGame?: boolean | null;
  iconUrl?: string | null;
  releaseDate?: string | null;
  provenance?: Provenance;
  tracked?: boolean;
  bundleId?: string | null;
}

export function upsertListing(db: Db, l: ListingUpsert): number {
  const now = nowIso();
  const ex = get<{ id: number }>(db, 'SELECT id FROM listings WHERE platform = ? AND store_id = ?', [l.platform, l.storeId]);
  if (ex) {
    run(
      db,
      `UPDATE listings SET title = COALESCE(?, title), publisher_id = COALESCE(?, publisher_id), category_id = COALESCE(?, category_id),
       is_game = CASE WHEN ? IS NULL THEN is_game ELSE ? END, icon_url = COALESCE(?, icon_url), release_date = COALESCE(release_date, ?),
       last_seen_at = ?, tracked = MAX(tracked, ?), bundle_id = COALESCE(bundle_id, ?) WHERE id = ?`,
      [l.title || null, l.publisherId ?? null, l.categoryId ?? null, l.isGame == null ? null : 1, l.isGame ? 1 : 0, l.iconUrl ?? null, l.releaseDate ?? null, now, l.tracked ? 1 : 0, l.bundleId ?? null, ex.id],
    );
    return ex.id;
  }
  const r = run(
    db,
    `INSERT INTO listings (platform, store_id, title, publisher_id, category_id, is_game, icon_url, release_date, provenance, first_seen_at, last_seen_at, tracked, bundle_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [l.platform, l.storeId, l.title, l.publisherId ?? null, l.categoryId ?? null, l.isGame ? 1 : 0, l.iconUrl ?? null, l.releaseDate ?? null, l.provenance ?? 'observed', now, now, l.tracked ? 1 : 0, l.bundleId ?? null],
  );
  return Number(r.lastInsertRowid);
}

/** Upsert a listing from a normalized provider record and store the observation. Returns listing id. */
export function storeListingObservation(
  db: Db,
  n: ListingNorm,
  ctx: { provider: string; provenance: Provenance; runId?: number | null; importId?: number | null; snapshotDay: string; observedAt?: string; tracked?: boolean },
): number {
  let listingId: number;
  const existing = get<{ id: number }>(db, 'SELECT id FROM listings WHERE platform = ? AND store_id = ?', [n.platform, n.storeId]);
  if (n.availability === 'available' && n.title) {
    const pub = ensurePublisher(db, n.platform, n.publisherStoreId, n.publisherName, n.publisherUrl, ctx.provenance);
    const cat = ensureCategory(db, n.platform, n.categoryId, n.categoryName, n.isGame);
    listingId = upsertListing(db, {
      platform: n.platform, storeId: n.storeId, title: n.title, publisherId: pub, categoryId: cat, isGame: n.isGame,
      iconUrl: n.iconUrl, releaseDate: n.releaseDate, provenance: ctx.provenance, tracked: ctx.tracked, bundleId: n.bundleId ?? null,
    });
  } else if (existing) {
    listingId = existing.id;
  } else {
    listingId = upsertListing(db, { platform: n.platform, storeId: n.storeId, title: n.storeId, provenance: ctx.provenance, tracked: ctx.tracked });
  }
  run(
    db,
    `INSERT INTO listing_observations (listing_id, market, language, provider, provenance, import_id, run_id, snapshot_day, observed_at, source_url, availability,
       title, subtitle, description, version, store_updated_at, release_date, price, currency, rating, rating_count, rating_scope, install_band, install_lower_bound,
       has_ads, has_iap, content_rating, genre_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(listing_id, market, provider, provenance, snapshot_day) DO UPDATE SET
       observed_at=excluded.observed_at, source_url=excluded.source_url, availability=excluded.availability, title=excluded.title, subtitle=excluded.subtitle,
       description=excluded.description, version=excluded.version, store_updated_at=excluded.store_updated_at, release_date=excluded.release_date,
       price=excluded.price, currency=excluded.currency, rating=excluded.rating, rating_count=excluded.rating_count, rating_scope=excluded.rating_scope,
       install_band=excluded.install_band, install_lower_bound=excluded.install_lower_bound, has_ads=excluded.has_ads, has_iap=excluded.has_iap,
       content_rating=excluded.content_rating, genre_label=excluded.genre_label, run_id=excluded.run_id`,
    [
      listingId, n.market, n.language, ctx.provider, ctx.provenance, ctx.importId ?? null, ctx.runId ?? null, ctx.snapshotDay, ctx.observedAt ?? nowIso(), n.sourceUrl,
      n.availability, n.title, n.subtitle ?? null, n.description, n.version, n.storeUpdatedAt, n.releaseDate, n.price, n.currency, n.rating, n.ratingCount,
      n.ratingScope, n.installBand, n.installLowerBound, n.hasAds == null ? null : n.hasAds ? 1 : 0, n.hasIap == null ? null : n.hasIap ? 1 : 0,
      n.contentRating, n.categoryName,
    ],
  );
  return listingId;
}

export interface StoreChartResult {
  snapshotId: number | null;
  skipped: boolean;
  reason?: string;
  listingIds: number[];
}

const snapKey = `provider = ? AND provenance = ? AND platform = ? AND market = ? AND device = ? AND chart_type = ? AND category = ? AND category_scope = ? AND snapshot_day = ?`;

/**
 * Store a chart snapshot. Re-running the same verified scope on the same provider day is deduplicated:
 * a complete snapshot is kept as-is; a failed/partial one is replaced by a better fetch.
 */
export function storeChart(db: Db, c: ChartNorm, ctx: { provenance: Provenance; runId?: number | null; importId?: number | null; allowReplace?: boolean }): StoreChartResult {
  const keyParams = [c.provider, ctx.provenance, c.platform, c.market, c.device, c.chartType, c.category, c.categoryScope, c.snapshotDay];
  const ex = get<{ id: number; status: SnapshotStatus; observed_depth: number }>(db, `SELECT id, status, observed_depth FROM chart_snapshots WHERE ${snapKey}`, keyParams);
  const status: SnapshotStatus = c.entries.length === 0 ? 'empty' : c.entries.length >= c.requestedDepth ? 'complete' : 'partial';
  if (ex && !ctx.allowReplace) {
    const better = ex.status === 'failed' || ex.status === 'empty' || (ex.status === 'partial' && c.entries.length > ex.observed_depth);
    if (!better) return { snapshotId: ex.id, skipped: true, reason: `duplicate: ${ex.status} snapshot for ${c.snapshotDay} already stored`, listingIds: [] };
  }
  const listingIds: number[] = [];
  let snapshotId: number;
  if (ex) {
    run(db, 'DELETE FROM chart_entries WHERE snapshot_id = ?', [ex.id]);
    run(db, 'UPDATE chart_snapshots SET run_id = ?, import_id = ?, fetched_at = ?, requested_depth = ?, observed_depth = ?, status = ?, source_url = ?, error_class = NULL WHERE id = ?', [
      ctx.runId ?? null, ctx.importId ?? null, c.fetchedAt, c.requestedDepth, c.entries.length, status, c.sourceUrl, ex.id,
    ]);
    snapshotId = ex.id;
  } else {
    const r = run(
      db,
      `INSERT INTO chart_snapshots (run_id, import_id, provider, provenance, platform, market, device, chart_type, category, category_scope, snapshot_day, fetched_at, requested_depth, observed_depth, status, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ctx.runId ?? null, ctx.importId ?? null, c.provider, ctx.provenance, c.platform, c.market, c.device, c.chartType, c.category, c.categoryScope, c.snapshotDay, c.fetchedAt, c.requestedDepth, c.entries.length, status, c.sourceUrl],
    );
    snapshotId = Number(r.lastInsertRowid);
  }
  const ins = db.prepare('INSERT OR IGNORE INTO chart_entries (snapshot_id, listing_id, rank, price, currency) VALUES (?, ?, ?, ?, ?)');
  for (const e of c.entries) {
    const pub = ensurePublisher(db, c.platform, e.publisherStoreId, e.publisherName, e.publisherUrl, ctx.provenance);
    const cat = ensureCategory(db, c.platform, e.categoryId, e.categoryName, e.categoryId === '6014' || (e.categoryId ?? '').startsWith('70') || (e.categoryId ?? '').startsWith('GAME'));
    const isGame = e.categoryId ? e.categoryId === '6014' || /^70\d\d$/.test(e.categoryId) || e.categoryId.startsWith('GAME') : c.category === '6014' ? true : null;
    const id = upsertListing(db, { platform: c.platform, storeId: e.storeId, title: e.title, publisherId: pub, categoryId: cat, isGame, iconUrl: e.iconUrl, releaseDate: e.releaseDate, provenance: ctx.provenance, bundleId: e.bundleId ?? null });
    ins.run(snapshotId, id, e.rank, e.price, e.currency);
    listingIds.push(id);
  }
  return { snapshotId, skipped: false, listingIds };
}

export function recordFailedSnapshot(
  db: Db,
  s: { provider: string; provenance: Provenance; platform: Platform; market: string; device: Device; chartType: ChartType; category: string; categoryScope: CategoryScope; snapshotDay: string; requestedDepth: number; sourceUrl: string; errorClass: string; runId: number | null },
) {
  const keyParams = [s.provider, s.provenance, s.platform, s.market, s.device, s.chartType, s.category, s.categoryScope, s.snapshotDay];
  const ex = get<{ id: number }>(db, `SELECT id FROM chart_snapshots WHERE ${snapKey}`, keyParams);
  if (ex) return; // never overwrite an earlier good fetch of the same day with a failure
  run(
    db,
    `INSERT INTO chart_snapshots (run_id, provider, provenance, platform, market, device, chart_type, category, category_scope, snapshot_day, fetched_at, requested_depth, observed_depth, status, source_url, error_class)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'failed', ?, ?)`,
    [s.runId, s.provider, s.provenance, s.platform, s.market, s.device, s.chartType, s.category, s.categoryScope, s.snapshotDay, nowIso(), s.requestedDepth, s.sourceUrl, s.errorClass],
  );
}

export function listingIdsNeedingLookup(db: Db, market: string, day: string, limit: number): string[] {
  return all<{ store_id: string }>(
    db,
    `SELECT l.store_id FROM listings l
     WHERE l.platform = 'ios' AND l.provenance != 'demo'
       AND NOT EXISTS (SELECT 1 FROM listing_observations o WHERE o.listing_id = l.id AND o.market = ? AND o.provider = 'itunes-lookup' AND o.snapshot_day = ?)
       AND (l.tracked = 1 OR EXISTS (SELECT 1 FROM chart_entries e JOIN chart_snapshots s ON s.id = e.snapshot_id WHERE e.listing_id = l.id AND s.market = ? AND s.provenance = 'observed'
             AND s.snapshot_day >= (SELECT date(MAX(s2.snapshot_day), '-1 day') FROM chart_snapshots s2 WHERE s2.market = ? AND s2.provenance = 'observed' AND s2.status IN ('complete','partial'))))
     ORDER BY l.tracked DESC, l.id LIMIT ?`,
    [market, day, market, market, limit],
  ).map((r) => r.store_id);
}
