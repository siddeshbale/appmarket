# Public static export (optional)

Builds a read-only website from a sanitized dataset. Nothing is deployed automatically.

```bash
npm run export:public          # from the live DB   (Windows/Linux/macOS)
npm run export:public:demo     # from the demo DB (fictional)
npm run verify:public          # checks for private keys/text, imported listings, public-mode bundle, size
npm run preview:public         # http://127.0.0.1:4174
```

Output: `dist-public/` (`index.html`, `assets/`, `data/dataset.json`, `data/README.txt`). It uses hash routing and relative paths, so it works from any sub-path.

## What is included

Only fields listed as redistributable in the provider manifest: chart scopes and ranks with movement (observed or demo provenance), listing id/title/developer/category/icon URL/release date, observed metadata (price, rating, rating count, install threshold, version, update date, disclosure flags), verified cross-store links, coverage and provider status, and evidence you explicitly marked public (reference link only). Default window: 90 days (`--history-days`).

## What is never included

Private notes, non-public evidence, onboarding teardowns, keyword data, first-party analytics, import metadata, imported listings and imported charts, app descriptions, raw HTTP payloads/cache, run logs, settings, credentials (none exist), and any write endpoint. Public-mode watchlists live in the visitor's browser `localStorage` and are labeled as such.

## Free-tier static hosting (you choose; check current terms)

Any static host works — e.g. GitHub Pages, Cloudflare Pages, Netlify. Typical free-tier limits (verify on the provider's site; they change): GitHub Pages ~1 GB site / 100 GB monthly bandwidth soft limits; Cloudflare Pages 500 builds/month and 20,000 files per site; Netlify 100 GB bandwidth/month. The dataset is usually well under 10 MB. Do not enable paid add-ons or automatic plan upgrades; this export needs none.

Before publishing, review Apple's and Google's terms for the fields you republish, keep attribution links, and re-run `npm run verify:public`.
