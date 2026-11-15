// Strict parsing of store identifiers and URLs. The server never fetches arbitrary URLs:
// user input is reduced to (platform, storeId) and request URLs are rebuilt from allowlisted templates.

import type { Platform } from './types';

export interface ParsedStoreRef {
  platform: Platform;
  storeId: string;
  /** Country found in the URL, if any (lowercase ISO alpha-2). Never used to silently replace the selected market. */
  urlCountry?: string;
}

const APPLE_ID = /^\d{5,12}$/;
// Android package: segments of letters/digits/underscore, starting with a letter, at least two segments.
const ANDROID_PKG = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

export const APPLE_HOSTS = new Set(['apps.apple.com', 'itunes.apple.com']);
export const PLAY_HOSTS = new Set(['play.google.com']);

export function isAppleId(s: string): boolean {
  return APPLE_ID.test(s);
}
export function isAndroidPackage(s: string): boolean {
  return s.length <= 255 && ANDROID_PKG.test(s);
}

export function parseStoreRef(input: string): ParsedStoreRef | null {
  const raw = (input ?? '').trim();
  if (!raw || raw.length > 2048) return null;
  if (/^id\d{5,12}$/i.test(raw)) return { platform: 'ios', storeId: raw.slice(2) };
  if (isAppleId(raw)) return { platform: 'ios', storeId: raw };
  if (!/^https?:\/\//i.test(raw) && isAndroidPackage(raw)) return { platform: 'android', storeId: raw };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (APPLE_HOSTS.has(host)) {
    const m = url.pathname.match(/\/id(\d{5,12})(?:\/|$)/);
    if (!m) return null;
    const cc = url.pathname.match(/^\/([a-z]{2})\//i);
    return { platform: 'ios', storeId: m[1], urlCountry: cc ? cc[1].toLowerCase() : undefined };
  }
  if (PLAY_HOSTS.has(host)) {
    if (!url.pathname.startsWith('/store/apps/details')) return null;
    const id = url.searchParams.get('id') ?? '';
    if (!isAndroidPackage(id)) return null;
    const gl = url.searchParams.get('gl');
    return { platform: 'android', storeId: id, urlCountry: gl && /^[a-z]{2}$/i.test(gl) ? gl.toLowerCase() : undefined };
  }
  return null;
}

export function storeListingUrl(platform: Platform, storeId: string, market: string, lang = 'en'): string {
  const cc = encodeURIComponent(market.toLowerCase());
  if (platform === 'ios') return `https://apps.apple.com/${cc}/app/id${encodeURIComponent(storeId)}`;
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(storeId)}&hl=${encodeURIComponent(lang)}&gl=${cc.toUpperCase()}`;
}

/** Official store search links for manual research (opened by the user in their browser, never fetched by the server). */
export function storeSearchUrl(platform: Platform, term: string, market: string): string {
  const q = encodeURIComponent(term);
  if (platform === 'android') return `https://play.google.com/store/search?q=${q}&c=apps&gl=${market.toUpperCase()}`;
  return `https://www.apple.com/${market.toLowerCase() === 'us' ? '' : market.toLowerCase() + '/'}search/${q}?src=globalnav`;
}

export function adLibraryLinks(term: string, market: string): { label: string; url: string; note: string }[] {
  const q = encodeURIComponent(term);
  const cc = encodeURIComponent(market.toUpperCase());
  return [
    {
      label: 'Meta Ad Library',
      url: `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${cc}&q=${q}&search_type=keyword_unordered`,
      note: 'Paid ads on Meta surfaces. Coverage and displayed metrics vary by country and ad category.',
    },
    {
      label: 'TikTok Creative Center — Top Ads',
      url: `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?region=${cc}&keyword=${q}`,
      note: 'A curated sample of top ads; not a complete ad register.',
    },
    {
      label: 'Google Ads Transparency Center',
      url: `https://adstransparency.google.com/?region=${cc}&q=${q}`,
      note: 'Advertiser-level search; enter the advertiser name if the query does not match.',
    },
  ];
}

export function isSafeExternalUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:';
  } catch {
    return false;
  }
}
