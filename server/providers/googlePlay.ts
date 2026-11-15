// Google Play public detail-page reader for packages the user has registered.
// - Only fetches https://play.google.com/store/apps/details?id=<validated package>&hl=..&gl=.. (allowed by robots.txt at validation time).
// - Never fetches /store/search, /store/xhr or /_/ endpoints (disallowed by robots.txt).
// - Does NOT produce chart ranks: no validated ranked chart source exists (see docs/PROVIDERS.md).
// - Install counts are the displayed lifetime threshold (e.g. "500M+") stored as a lower bound — never an exact or monthly count.
import { isAndroidPackage } from '../../shared/storeUrls';
import type { PoliteClient } from '../http/client';
import { MalformedPayloadError, type ListingNorm } from './types';

export function playDetailsUrl(pkg: string, market: string, lang = 'en') {
  if (!isAndroidPackage(pkg)) throw new Error('invalid package');
  if (!/^[a-z]{2}$/.test(market)) throw new Error('bad market');
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(lang)) throw new Error('bad language');
  return `https://play.google.com/store/apps/details?id=${pkg}&hl=${lang}&gl=${market.toUpperCase()}`;
}

/** "500M+" -> 500000000, "1,000+" -> 1000, "10B+" -> 1e10 */
export function installLowerBound(band: string | null): number | null {
  if (!band) return null;
  const m = band.replace(/\s/g, '').match(/^([\d.,]+)([KMB])?\+$/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  return Math.round(n * mult);
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function parsePlayDetails(html: string, pkg: string, market: string, lang: string, url: string): ListingNorm {
  const ldMatch = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!ldMatch) throw new MalformedPayloadError('Detail page has no structured data block (layout change or interstitial)');
  let ld: any;
  try {
    ld = JSON.parse(ldMatch[1]);
  } catch {
    throw new MalformedPayloadError('Structured data is not valid JSON');
  }
  if (ld?.['@type'] !== 'SoftwareApplication' || typeof ld?.name !== 'string') throw new MalformedPayloadError('Structured data is not a SoftwareApplication');
  const band = html.match(/>([0-9][0-9.,]*[KMB]?\+)<\/div><div[^>]*>Downloads</)?.[1] ?? null;
  const updated = html.match(/Updated on<\/div><div[^>]*>([^<]{4,40})</)?.[1] ?? null;
  const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
  const cat = typeof ld.applicationCategory === 'string' ? ld.applicationCategory : null;
  const ratingValue = Number(ld?.aggregateRating?.ratingValue);
  const ratingCount = Number(ld?.aggregateRating?.ratingCount);
  // Flags are only recorded as true when the disclosure text is present in English pages; otherwise unknown (null).
  const english = lang.startsWith('en');
  return {
    platform: 'android',
    storeId: pkg,
    market,
    language: lang,
    availability: 'available',
    title: decode(ld.name),
    description: typeof ld.description === 'string' ? decode(ld.description).slice(0, 8000) : null,
    publisherName: typeof ld?.author?.name === 'string' ? decode(ld.author.name) : null,
    publisherStoreId: null,
    publisherUrl: null,
    categoryId: cat,
    categoryName: cat,
    isGame: cat ? cat.startsWith('GAME') : null,
    price: offer && Number.isFinite(Number(offer.price)) ? Number(offer.price) : null,
    currency: typeof offer?.priceCurrency === 'string' ? offer.priceCurrency : null,
    rating: Number.isFinite(ratingValue) ? Math.round(ratingValue * 100) / 100 : null,
    ratingCount: Number.isFinite(ratingCount) ? ratingCount : null,
    ratingScope: 'displayed aggregate, this country/language page',
    version: null,
    storeUpdatedAt: updated && Number.isFinite(Date.parse(updated)) ? new Date(Date.parse(updated + ' UTC')).toISOString() : null,
    releaseDate: null,
    iconUrl: typeof ld.image === 'string' ? ld.image : null,
    installBand: band,
    installLowerBound: installLowerBound(band),
    hasAds: english ? /Contains ads/.test(html) : null,
    hasIap: english ? /In-app purchases/.test(html) : null,
    contentRating: typeof ld.contentRating === 'string' ? ld.contentRating : null,
    sourceUrl: url,
    bundleId: pkg,
  };
}

export async function fetchPlayDetails(client: PoliteClient, pkg: string, market: string, lang = 'en'): Promise<ListingNorm> {
  const url = playDetailsUrl(pkg, market, lang);
  try {
    const r = await client.getText(url);
    return parsePlayDetails(r.body, pkg, market, lang, url);
  } catch (e: any) {
    if (e?.errorClass === 'not_found') {
      return {
        platform: 'android', storeId: pkg, market, language: lang, availability: 'unavailable', title: null, description: null, publisherName: null,
        publisherStoreId: null, publisherUrl: null, categoryId: null, categoryName: null, isGame: null, price: null, currency: null, rating: null,
        ratingCount: null, ratingScope: null, version: null, storeUpdatedAt: null, releaseDate: null, iconUrl: null, installBand: null,
        installLowerBound: null, hasAds: null, hasIap: null, contentRating: null, sourceUrl: url,
      };
    }
    throw e;
  }
}
