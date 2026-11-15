// Source manifest: documentation, accessible fields, intended use, terms notes and what may be redistributed
// in the public static export. Live validation results are recorded separately (settings: validation:*) by
// `npm run smoke:live` and shown in Data & Settings.
import type { ProviderInfo } from './types';

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'apple-itunes-rss',
    name: 'Apple iTunes RSS chart feeds (legacy generator)',
    platform: 'ios',
    status: 'enabled',
    capabilities: {
      charts: { chartTypes: ['free', 'paid', 'grossing'], devices: ['iphone', 'ipad'], categoryCharts: true, maxDepth: 200 },
      fields: ['rank', 'app id', 'name', 'developer', 'primary category', 'price', 'release date', 'icon', 'store URL'],
    },
    markets: 'registry',
    docsUrl: 'https://rss.marketingtools.apple.com/',
    termsUrl: 'https://www.apple.com/legal/internet-services/itunes/',
    rateLimit: 'No published quota. We use ≤1 request per 1.5 s, sequential, with backoff; cached 6 h.',
    intendedUse:
      'Apple-hosted public RSS chart feeds intended for promotion/linking of App Store content. Used for country-scoped daily chart snapshots.',
    publicExportFields: ['rank', 'app id', 'name', 'developer', 'category', 'store URL', 'snapshot day'],
    limitations: [
      'Legacy feed family from the iTunes RSS generator; Apple still serves it but no longer documents it on the current generator page. It may be retired without notice — the run then fails visibly and prior data is kept.',
      'Category charts are real genre charts served by Apple (genre=<id>), not local filters.',
      'Top grossing is a rank only — it carries no revenue figure.',
    ],
  },
  {
    id: 'apple-rss-v2',
    name: 'Apple Marketing Tools RSS (v2)',
    platform: 'ios',
    status: 'optional',
    capabilities: {
      charts: { chartTypes: ['free', 'paid'], devices: ['unspecified'], categoryCharts: false, maxDepth: 100, depthOptions: [10, 25, 50, 100] },
      fields: ['rank', 'app id', 'name', 'developer', 'release date', 'icon', 'store URL'],
    },
    markets: 'registry',
    docsUrl: 'https://rss.marketingtools.apple.com/',
    termsUrl: 'https://www.apple.com/legal/internet-services/itunes/',
    rateLimit: 'No published quota; same politeness policy as above.',
    intendedUse: 'Documented current generator. All-store top free / top paid only; device is not specified by the source, so it is stored as device "unspecified" and never mixed with iPhone charts.',
    publicExportFields: ['rank', 'app id', 'name', 'developer', 'store URL', 'snapshot day'],
    limitations: ['No category charts and no grossing chart.', 'Genres field is empty in current payloads.', 'Top paid returned HTTP 502 during validation on 2026-11-15.'],
  },
  {
    id: 'itunes-lookup',
    name: 'iTunes Search & Lookup API',
    platform: 'ios',
    status: 'enabled',
    capabilities: {
      lookup: true,
      search: true,
      fields: ['name', 'developer', 'primary genre', 'price', 'currency', 'average rating', 'rating count (storefront)', 'version', 'current version date', 'release date', 'description', 'content rating'],
    },
    markets: 'registry',
    docsUrl: 'https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html',
    termsUrl: 'https://www.apple.com/legal/internet-services/itunes/',
    rateLimit: 'Apple documents roughly 20 calls per minute. We batch up to 100 ids per lookup and space calls ≥1.5 s.',
    intendedUse: 'Country-scoped metadata for listings seen in charts or registered by the user; title search.',
    publicExportFields: ['name', 'developer', 'genre', 'price', 'currency', 'rating', 'rating count', 'version', 'update date', 'release date'],
    limitations: [
      'Search API result order is NOT App Store search ranking; it is never stored as a keyword position.',
      'Rating counts are storefront totals, not downloads.',
      'Descriptions are kept locally for Keyword Lab and are excluded from the public export.',
    ],
  },
  {
    id: 'google-play-details',
    name: 'Google Play public detail pages',
    platform: 'android',
    status: 'enabled',
    capabilities: {
      lookup: true,
      fields: ['name', 'developer', 'category', 'price', 'currency', 'displayed rating', 'displayed rating count', 'install threshold (lifetime lower bound)', 'updated date', 'contains ads', 'in-app purchases', 'content rating'],
    },
    markets: 'registry',
    docsUrl: 'https://play.google.com/store/apps',
    termsUrl: 'https://policies.google.com/terms',
    rateLimit: 'No public API or quota. We fetch only registered packages, ≤1 request per 4 s, cap 30 per run, cached 6 h.',
    intendedUse:
      'Reads the public detail page of a package the user registered. robots.txt (checked 2026-11-15) disallows /store/search, /store/xhr and /_/ but not /store/apps/details; Google ToS prohibits automated access that violates robots.txt. Disable with GOOGLE_PLAY_READER_ENABLED=false.',
    publicExportFields: ['name', 'developer', 'category', 'install threshold', 'snapshot day'],
    limitations: [
      'No chart ranks: Play top charts are not available as a validated ranked list for an exact scope. Android ranks come only from imports/manual observations.',
      'No search: /store/search is disallowed by robots.txt. Use the official Play search link + local catalog search.',
      'Page layout can change; parsing failures are classified as malformed and surfaced, never filled with guesses.',
      'Install thresholds are lifetime lower bounds (e.g. 500M+), never exact or monthly installs.',
    ],
  },
  {
    id: 'google-play-charts',
    name: 'Google Play top charts',
    platform: 'android',
    status: 'unsupported',
    capabilities: { charts: { chartTypes: ['free', 'paid', 'grossing'], devices: ['android_phone'], categoryCharts: true, maxDepth: 0 }, fields: [] },
    markets: [],
    docsUrl: 'https://play.google.com/store/games',
    termsUrl: 'https://policies.google.com/terms',
    rateLimit: 'n/a',
    intendedUse: 'Not automated. The public pages did not expose a ranked chart list in a static response during validation, and the dynamic endpoints are disallowed by robots.txt.',
    publicExportFields: [],
    limitations: ['Use CSV/JSON chart-snapshot import or manual observations; these are labeled User-supplied.'],
  },
  {
    id: 'ad-libraries',
    name: 'Ad transparency libraries (Meta, TikTok, Google)',
    platform: 'multi',
    status: 'unsupported',
    capabilities: { fields: ['outbound search links only'] },
    markets: 'registry',
    docsUrl: 'https://www.facebook.com/ads/library/',
    termsUrl: null,
    rateLimit: 'n/a — links are opened by you in your browser.',
    intendedUse: 'Evidence library stores references (URLs, notes, displayed metrics with labels). No scraping, no media copying.',
    publicExportFields: [],
    limitations: ['No comprehensive commercial ad API is assumed. Repeated ad appearances are never converted into spend, sales or ROAS.'],
  },
];

export function providerById(id: string) {
  return PROVIDERS.find((p) => p.id === id);
}
