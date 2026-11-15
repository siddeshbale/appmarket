// Apple App Store connectors:
//  - apple-itunes-rss: legacy iTunes RSS chart feeds (itunes.apple.com/{cc}/rss/...). Supports free/paid/grossing,
//    iPhone vs iPad, real genre (category) charts, depth up to 200.
//  - apple-rss-v2: Apple Marketing Tools RSS generator (rss.marketingtools.apple.com). Top free / top paid, all-store only,
//    device not specified by the source.
//  - itunes-lookup: iTunes Search & Lookup API for country-scoped metadata and title search.
import type { ChartType, Device } from '../../shared/types';
import type { PoliteClient } from '../http/client';
import { MalformedPayloadError, type ChartEntryNorm, type ChartNorm, type ListingNorm } from './types';

const LEGACY_FEED: Record<string, Record<ChartType, string>> = {
  iphone: { free: 'topfreeapplications', paid: 'toppaidapplications', grossing: 'topgrossingapplications' },
  ipad: { free: 'topfreeipadapplications', paid: 'toppaidipadapplications', grossing: 'topgrossingipadapplications' },
};

const CC = /^[a-z]{2}$/;

export function legacyChartUrl(market: string, device: 'iphone' | 'ipad', chartType: ChartType, genre: string, depth: number): string {
  if (!CC.test(market)) throw new Error('bad market');
  if (genre !== 'all' && !/^\d{4}$/.test(genre)) throw new Error('bad genre');
  const d = Math.max(1, Math.min(200, Math.floor(depth)));
  return `https://itunes.apple.com/${market}/rss/${LEGACY_FEED[device][chartType]}/limit=${d}${genre === 'all' ? '' : `/genre=${genre}`}/json`;
}

const lbl = (x: any): string | null => (x && typeof x.label === 'string' ? x.label : null);
const attr = (x: any, k: string): string | null => (x && x.attributes && typeof x.attributes[k] === 'string' ? x.attributes[k] : null);

/** Provider snapshot day = the feed's own "updated" timestamp in UTC (falls back to fetch day). */
export function snapshotDayFrom(updated: string | null, fetchedAt: string): string {
  if (updated) {
    const t = Date.parse(updated);
    if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  }
  return fetchedAt.slice(0, 10);
}

export function parseLegacyChart(
  body: string,
  meta: { market: string; device: 'iphone' | 'ipad'; chartType: ChartType; genre: string; depth: number; url: string; fetchedAt: string },
): ChartNorm {
  let j: any;
  try {
    j = JSON.parse(body);
  } catch {
    throw new MalformedPayloadError('Chart payload is not JSON');
  }
  const feed = j?.feed;
  if (!feed || typeof feed !== 'object') throw new MalformedPayloadError('Missing feed object');
  const raw = feed.entry === undefined ? [] : Array.isArray(feed.entry) ? feed.entry : [feed.entry];
  const entries: ChartEntryNorm[] = [];
  const seen = new Set<string>();
  raw.forEach((e: any, i: number) => {
    const id = attr(e?.id, 'im:id');
    const title = lbl(e?.['im:name']);
    if (!id || !/^\d{5,12}$/.test(id) || !title) throw new MalformedPayloadError(`Entry ${i + 1} lacks a valid id/name`);
    if (seen.has(id)) return; // duplicate ids in one chart are dropped, keeping the first (highest) rank
    seen.add(id);
    const artistHref = attr(e?.['im:artist'], 'href');
    const pubId = artistHref?.match(/\/id(\d+)/)?.[1] ?? null;
    const links = Array.isArray(e?.link) ? e.link : [e?.link];
    const href = links.map((l: any) => attr(l, 'href')).find((h: string | null) => h && /^https:\/\/apps\.apple\.com\//.test(h)) ?? null;
    const imgs = Array.isArray(e?.['im:image']) ? e['im:image'] : [];
    const amount = attr(e?.['im:price'], 'amount');
    const releaseRaw = lbl(e?.['im:releaseDate']);
    entries.push({
      rank: entries.length + 1,
      storeId: id,
      title,
      publisherName: lbl(e?.['im:artist']),
      publisherStoreId: pubId,
      publisherUrl: artistHref && /^https:\/\/apps\.apple\.com\//.test(artistHref) ? artistHref.split('?')[0] : null,
      categoryId: attr(e?.category, 'im:id'),
      categoryName: attr(e?.category, 'label'),
      price: amount !== null && Number.isFinite(Number(amount)) ? Number(amount) : null,
      currency: attr(e?.['im:price'], 'currency'),
      releaseDate: releaseRaw && Number.isFinite(Date.parse(releaseRaw)) ? new Date(Date.parse(releaseRaw)).toISOString().slice(0, 10) : null,
      iconUrl: lbl(imgs[imgs.length - 1]),
      url: href ? href.split('?')[0] : null,
      bundleId: attr(e?.id, 'im:bundleId'),
    });
  });
  return {
    provider: 'apple-itunes-rss',
    platform: 'ios',
    market: meta.market,
    device: meta.device,
    chartType: meta.chartType,
    category: meta.genre,
    categoryScope: meta.genre === 'all' ? 'all' : 'category',
    requestedDepth: meta.depth,
    snapshotDay: snapshotDayFrom(lbl(feed.updated), meta.fetchedAt),
    fetchedAt: meta.fetchedAt,
    sourceUrl: meta.url,
    entries,
  };
}

export async function fetchLegacyChart(client: PoliteClient, market: string, device: 'iphone' | 'ipad', chartType: ChartType, genre: string, depth: number) {
  const url = legacyChartUrl(market, device, chartType, genre, depth);
  const r = await client.getText(url);
  return parseLegacyChart(r.body, { market, device, chartType, genre, depth, url, fetchedAt: r.fetchedAt });
}

// ---------- Apple Marketing Tools RSS v2 ----------
export const V2_DEPTHS = [10, 25, 50, 100];
export function v2ChartUrl(market: string, chartType: 'free' | 'paid', depth: number) {
  if (!CC.test(market)) throw new Error('bad market');
  const d = V2_DEPTHS.find((x) => x >= depth) ?? 100;
  return `https://rss.marketingtools.apple.com/api/v2/${market}/apps/top-${chartType}/${d}/apps.json`;
}
export function parseV2Chart(body: string, meta: { market: string; chartType: 'free' | 'paid'; depth: number; url: string; fetchedAt: string }): ChartNorm {
  let j: any;
  try {
    j = JSON.parse(body);
  } catch {
    throw new MalformedPayloadError('Chart payload is not JSON');
  }
  const results = j?.feed?.results;
  if (!Array.isArray(results)) throw new MalformedPayloadError('Missing feed.results');
  const entries: ChartEntryNorm[] = [];
  results.forEach((r: any, i: number) => {
    if (typeof r?.id !== 'string' || !/^\d{5,12}$/.test(r.id) || typeof r?.name !== 'string') throw new MalformedPayloadError(`Result ${i + 1} invalid`);
    entries.push({
      rank: entries.length + 1,
      storeId: r.id,
      title: r.name,
      publisherName: typeof r.artistName === 'string' ? r.artistName : null,
      publisherStoreId: typeof r.artistUrl === 'string' ? (r.artistUrl.match(/\/id(\d+)/)?.[1] ?? null) : null,
      publisherUrl: null,
      categoryId: null,
      categoryName: null,
      price: null,
      currency: null,
      releaseDate: typeof r.releaseDate === 'string' ? r.releaseDate.slice(0, 10) : null,
      iconUrl: typeof r.artworkUrl100 === 'string' ? r.artworkUrl100 : null,
      url: typeof r.url === 'string' ? r.url : null,
    });
  });
  return {
    provider: 'apple-rss-v2',
    platform: 'ios',
    market: meta.market,
    device: 'unspecified' as Device,
    chartType: meta.chartType,
    category: 'all',
    categoryScope: 'all',
    requestedDepth: meta.depth,
    snapshotDay: snapshotDayFrom(typeof j?.feed?.updated === 'string' ? j.feed.updated : null, meta.fetchedAt),
    fetchedAt: meta.fetchedAt,
    sourceUrl: meta.url,
    entries,
  };
}
export async function fetchV2Chart(client: PoliteClient, market: string, chartType: 'free' | 'paid', depth: number) {
  const url = v2ChartUrl(market, chartType, depth);
  const r = await client.getText(url);
  return parseV2Chart(r.body, { market, chartType, depth, url, fetchedAt: r.fetchedAt });
}

// ---------- iTunes Search & Lookup ----------
export function lookupUrl(ids: string[], market: string) {
  if (!CC.test(market)) throw new Error('bad market');
  const clean = ids.filter((i) => /^\d{5,12}$/.test(i));
  if (!clean.length || clean.length > 150) throw new Error('lookup needs 1-150 numeric ids');
  return `https://itunes.apple.com/lookup?id=${clean.join(',')}&country=${market}&entity=software`;
}
export function searchUrl(term: string, market: string, limit = 25) {
  if (!CC.test(market)) throw new Error('bad market');
  const t = term.trim().slice(0, 100);
  return `https://itunes.apple.com/search?term=${encodeURIComponent(t)}&country=${market}&entity=software&limit=${Math.max(1, Math.min(50, limit))}`;
}

function isoDay(s: unknown): string | null {
  return typeof s === 'string' && Number.isFinite(Date.parse(s)) ? new Date(Date.parse(s)).toISOString() : null;
}

export function normalizeItunesResult(r: any, market: string, url: string): ListingNorm | null {
  if (!r || (r.kind !== 'software' && r.wrapperType !== 'software') || !r.trackId) return null;
  const genreIds: string[] = Array.isArray(r.genreIds) ? r.genreIds.map(String) : [];
  return {
    platform: 'ios',
    storeId: String(r.trackId),
    market,
    language: null,
    availability: 'available',
    title: typeof r.trackName === 'string' ? r.trackName : null,
    description: typeof r.description === 'string' ? r.description.slice(0, 8000) : null,
    publisherName: typeof r.artistName === 'string' ? r.artistName : typeof r.sellerName === 'string' ? r.sellerName : null,
    publisherStoreId: r.artistId ? String(r.artistId) : null,
    publisherUrl: typeof r.artistViewUrl === 'string' ? r.artistViewUrl.split('?')[0] : null,
    categoryId: r.primaryGenreId ? String(r.primaryGenreId) : null,
    categoryName: typeof r.primaryGenreName === 'string' ? r.primaryGenreName : null,
    isGame: r.primaryGenreId === 6014 || genreIds.includes('6014'),
    price: typeof r.price === 'number' ? r.price : null,
    currency: typeof r.currency === 'string' ? r.currency : null,
    rating: typeof r.averageUserRating === 'number' ? r.averageUserRating : null,
    ratingCount: typeof r.userRatingCount === 'number' ? r.userRatingCount : null,
    ratingScope: 'all versions, this storefront (iTunes Lookup)',
    version: typeof r.version === 'string' ? r.version : null,
    storeUpdatedAt: isoDay(r.currentVersionReleaseDate),
    releaseDate: isoDay(r.releaseDate)?.slice(0, 10) ?? null,
    iconUrl: typeof r.artworkUrl100 === 'string' ? r.artworkUrl100 : null,
    installBand: null,
    installLowerBound: null,
    hasAds: null,
    hasIap: null,
    contentRating: typeof r.contentAdvisoryRating === 'string' ? r.contentAdvisoryRating : null,
    sourceUrl: url,
    bundleId: typeof r.bundleId === 'string' ? r.bundleId : null,
  };
}

export function parseLookup(body: string, ids: string[], market: string, url: string): ListingNorm[] {
  let j: any;
  try {
    j = JSON.parse(body);
  } catch {
    throw new MalformedPayloadError('Lookup payload is not JSON');
  }
  if (!Array.isArray(j?.results)) throw new MalformedPayloadError('Lookup payload lacks results');
  const found = new Map<string, ListingNorm>();
  for (const r of j.results) {
    const n = normalizeItunesResult(r, market, url);
    if (n) found.set(n.storeId, n);
  }
  // Requested ids absent from a successful response are unavailable in THIS storefront (not globally).
  return ids.map(
    (id) =>
      found.get(id) ?? {
        platform: 'ios', storeId: id, market, language: null, availability: 'unavailable', title: null, description: null, publisherName: null,
        publisherStoreId: null, publisherUrl: null, categoryId: null, categoryName: null, isGame: null, price: null, currency: null, rating: null,
        ratingCount: null, ratingScope: null, version: null, storeUpdatedAt: null, releaseDate: null, iconUrl: null, installBand: null,
        installLowerBound: null, hasAds: null, hasIap: null, contentRating: null, sourceUrl: url,
      },
  );
}

export async function lookupApple(client: PoliteClient, ids: string[], market: string): Promise<ListingNorm[]> {
  const out: ListingNorm[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const url = lookupUrl(batch, market);
    const r = await client.getText(url);
    out.push(...parseLookup(r.body, batch, market, url));
  }
  return out;
}

export async function searchApple(client: PoliteClient, term: string, market: string, limit = 25): Promise<ListingNorm[]> {
  const url = searchUrl(term, market, limit);
  const r = await client.getText(url);
  let j: any;
  try {
    j = JSON.parse(r.body);
  } catch {
    throw new MalformedPayloadError('Search payload is not JSON');
  }
  if (!Array.isArray(j?.results)) throw new MalformedPayloadError('Search payload lacks results');
  return j.results.map((x: any) => normalizeItunesResult(x, market, url)).filter(Boolean) as ListingNorm[];
}
