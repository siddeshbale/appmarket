# Providers and fallbacks

Every connector implements the same shape (`server/providers/*`, manifest in `server/providers/manifest.ts`): declared capabilities and markets, fetch + normalize, source URL, UTC timestamp, explicit scope, rate policy, and error classification (`network`, `timeout`, `rate_limited`, `restricted`, `not_found`, `client_error`, `server_error`, `malformed`, `budget_exhausted`, `disabled`).

All requests go through `PoliteClient` (`server/http/client.ts`): allowlisted hosts only (`itunes.apple.com`, `rss.marketingtools.apple.com`, `play.google.com`), no redirect following, per-provider request budget, concurrency 1, minimum spacing, timeout, 6 h cache, exponential backoff with jitter for transient errors, `Retry-After` honored, and an immediate stop for the rest of the run on access restrictions (401/403/451, redirects to sign-in/consent, CAPTCHA/“unusual traffic” pages) or repeated rate limiting. One provider failing never stops the others, never switches the app to demo data, and never deletes earlier verified data (a failed fetch never overwrites a good snapshot for the same day).

## Live validation (2026-11-15, this environment)

Run with `npm run smoke:live -- --markets us,in,gb,jp` (10-entry charts, one lookup, one search, one Play page per market). Results are stored in the database and shown in **Data & settings → Sources**.

| Provider | US | IN | GB | JP |
|---|---|---|---|---|
| `apple-itunes-rss` iPhone free (all) | ✅ | ✅ | ✅ | ✅ |
| `apple-itunes-rss` iPhone grossing, Games (6014) | ✅ | ✅ | ✅ | ✅ |
| `apple-itunes-rss` iPad paid (all) | ✅ | ✅ | ✅ | ✅ |
| `apple-rss-v2` top free | ✅ | ✅ | ✅ | ❌ timeout (repeatable) |
| `apple-rss-v2` top paid | ✅ (502 earlier the same day) | ✅ | ✅ | ✅ |
| `itunes-lookup` lookup by id | ✅ USD | ✅ INR | ✅ GBP | ✅ JPY |
| `itunes-lookup` title search | ✅ | ✅ | ✅ | ✅ |
| `google-play-details` (`com.whatsapp`) | ✅ USD | ✅ INR | ✅ GBP | ✅ JPY |
| Google Play charts | ⛔ not supported | ⛔ | ⛔ | ⛔ |

A full live ingestion for US + IN (6 Apple charts × 2 markets at depth 100, then metadata lookups) stored 1,196 ranked entries and 887 metadata observations; an immediate rerun was deduplicated. A live Android URL lookup (`com.duolingo`) through the UI returned title, rating, rating count, `500M+` threshold, update date and ads/IAP disclosures.

Everything else (malformed payloads, throttling, restricted access, ties, gaps, imports) is covered by **fixture tests only** (`tests/*.test.ts`) and is not claimed as live-verified.

## 1. Apple — charts (`apple-itunes-rss`, enabled)

- Endpoint family: `https://itunes.apple.com/{cc}/rss/{feed}/limit={1-200}[/genre={id}]/json` with feeds `topfree|toppaid|topgrossing` × `applications` (iPhone) or `ipadapplications` (iPad).
- Provides real **category charts** (`genre=` Apple genre id), so category scope is `category`, not a filter. Device is explicit (iPhone vs iPad).
- Snapshot day = the feed's own `updated` timestamp converted to UTC.
- Caveat: this is the legacy iTunes RSS generator family. Apple still serves it but the current generator page (rss.marketingtools.apple.com) documents only the v2 feeds. If Apple retires it, runs fail visibly as `not_found`/`malformed` and the v2 provider can be enabled.
- Use: Apple publishes these feeds for linking to and promoting App Store content. We store rank, id, name, developer, category, price and links; the public export carries only rank, id, name, developer, category, store URL and day. Icons are hot-linked from Apple's CDN, not copied.

## 2. Apple — current RSS generator (`apple-rss-v2`, optional)

- `https://rss.marketingtools.apple.com/api/v2/{cc}/apps/top-{free|paid}/{10|25|50|100}/apps.json`
- All-store only, no grossing, device unspecified → stored with device `unspecified` and never mixed with iPhone charts.
- Enable per run: `npm run ingest -- --providers apple-rss-v2`.

## 3. Apple — iTunes Search & Lookup (`itunes-lookup`, enabled)

- Documented at the [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html). Apple notes roughly 20 calls/minute; we batch 100 ids per lookup and space requests.
- Country-scoped: `country={cc}`. An id missing from a successful lookup is recorded as **unavailable in that storefront**, not as missing data.
- Rating count = storefront total ratings, never downloads.
- Search result order is the API's, not App Store search ranking — never stored as a keyword position.
- Descriptions are stored locally for Keyword Lab and never exported publicly.

## 4. Google Play — public detail pages (`google-play-details`, enabled, configurable)

- Fetches only `https://play.google.com/store/apps/details?id={validated package}&hl=en&gl={CC}` for packages you registered (tracked). Never search, never `/store/xhr` or `/_/` RPC endpoints.
- Terms: Google's Terms of Service prohibit automated access that violates machine-readable instructions such as robots.txt. On 2026-11-15 `play.google.com/robots.txt` disallowed `/store/search`, `/store/xhr`, `/_` and others, but not `/store/apps/details`. Re-check before enabling at scale; disable entirely with `GOOGLE_PLAY_READER_ENABLED=false`.
- Politeness: ≥4 s between requests, 30 requests per run by default, 6 h cache.
- Parsed from the page's schema.org JSON-LD (name, developer, category id, price/currency, rating, rating count) plus displayed text: install threshold (`1M+` → lifetime lower bound 1,000,000), “Updated on” date, “Contains ads”, “In-app purchases” (English pages only; otherwise unknown).
- A page without structured data (layout change, consent interstitial) is `malformed`; nothing is guessed.

## 5. Google Play — charts (unsupported, by design)

The public Apps/Games pages did not expose a ranked chart list in a static response during validation, and the dynamic endpoints are disallowed by robots.txt. Carousel order and search results are not chart ranks, so **no Android rank is ever produced automatically**.

Fallbacks that work today: package/URL registration, manual observation form (per listing), official Play search link, local catalog search, and CSV/JSON chart-snapshot import (labeled User-supplied, kept in a separate `import` source scope). Android history, comparison and exports work entirely from these.

## 6. Ads and social (references only)

Outbound search links to the [Meta Ad Library](https://www.facebook.com/ads/library/), [TikTok Creative Center Top Ads](https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en) and [Google Ads Transparency Center](https://adstransparency.google.com/), plus your own publisher/creator links. Nothing is fetched or scraped; you record what you saw as evidence. No spend, sales, ROAS or conversion is inferred.

## Adding a market

1. `npm run smoke:live -- --markets de`
2. Data & settings → Markets → add `de`, then enable it.
3. Add `de` to `INGEST_MARKETS` (or pass `--markets`).
