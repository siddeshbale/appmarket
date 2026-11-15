# App Market Radar

Independent, local-first mobile market intelligence for the **Apple App Store** and **Google Play** — apps and games, all categories. Discover charts and movers, track competitors by URL or ID, compare listings, collect ad/creator/onboarding evidence, run keyword and monetization scenarios, and export source-linked research briefs.

- Runs entirely on your machine (Node + SQLite). No paid APIs, LLM keys, accounts or Docker.
- Every metric is labeled **Observed**, **User-supplied** or **Modeled**, with source, date and market.
- Not affiliated with Apple, Google or any analytics vendor. It does not estimate downloads or revenue.

## Requirements

- Node.js **24 LTS** (pinned in `package.json` `engines` and `.nvmrc`). Uses the built-in `node:sqlite` module, so there are no native build steps.
- npm 10+ (lockfile included).

## Quick start

### Windows (PowerShell)

```powershell
npm ci
Copy-Item .env.example .env   # optional; every setting has a default
npm run migrate
npm run demo                  # seeds FICTIONAL demo data, builds, serves http://127.0.0.1:5174
```

Live mode (real data):

```powershell
npm run build
npm run ingest                # first collection: Apple charts (US, IN) + metadata
npm start                     # http://127.0.0.1:5174
```

### Linux / macOS

```bash
npm ci
cp .env.example .env          # optional
npm run migrate
npm run demo                  # fictional demo data on http://127.0.0.1:5174
```

```bash
npm run build && npm run ingest && npm start
```

Development with hot reload: `npm run dev` (UI on http://127.0.0.1:5173, API on 5174). Demo variant: `npm run dev:demo`.

## Modes

| Mode | Database | Data | How |
|---|---|---|---|
| Live | `data/radar.db` | Observed + your imports | `npm start` |
| Demo | `data/demo.db` (separate file) | Clearly labeled **fictional** apps with 45 days of history, gaps, a failed fetch, ties, alerts | `npm run demo` / `npm run start:demo` |
| Public | static files in `dist-public/` | Sanitized, read-only snapshot | `npm run export:public` |

Demo and live data are never mixed: separate files, demo records carry provenance `demo`, and live ingestion refuses to run in demo mode.

## Scripts

| Script | Purpose |
|---|---|
| `npm run migrate` | Create/upgrade the SQLite schema (also runs automatically on start) |
| `npm run dev` / `dev:demo` | Vite + API with reload |
| `npm run build` | Type-check and build the UI into `dist/` |
| `npm start` / `start:demo` | Serve API + built UI on 127.0.0.1 |
| `npm run ingest` | Collect now (`-- --dry-run`, `--markets us,in`, `--providers apple-itunes-rss,itunes-lookup`, `--depth 50`, `--backup`) |
| `npm run seed:demo` / `demo` | Rebuild the fictional demo DB / seed + build + serve |
| `npm run smoke:live` | Small live requests per provider × market (`-- --markets us,in,gb,jp`); records validation results |
| `npm run smoke:api` | API smoke test against an in-memory demo DB |
| `npm run backup` | Consistent DB copy into `backups/` (keeps 14) |
| `npm run export:public` / `export:public:demo` | Build the static, read-only public site with a sanitized dataset |
| `npm run verify:public` | Check the public build for private fields and size |
| `npm run preview:public` | Serve `dist-public/` at http://127.0.0.1:4174 |
| `npm run lint` / `typecheck` / `test` | ESLint, TypeScript, Vitest (unit + fixture-backed ingestion) |
| `npm run test:e2e` | Build, then Playwright browser smoke test (uses installed Chrome; see below) |
| `npm run check` | lint + typecheck + test + build |

Browser test without Chrome: `npx playwright install chromium` then `E2E_CHANNEL=chromium npm run test:e2e` (PowerShell: `$env:E2E_CHANNEL='chromium'; npm run test:e2e`).

## What's in the app

- **Discover** — Top Charts, Trending (7/30-day movers with explanations), New to Chart (distinct from newly released), and Catalog search by title, publisher, store ID; filters for store, market, category (unified), apps vs games, price, release date; pagination; shareable URLs.
- **Track an app** — paste an App Store / Google Play URL, Apple ID or Android package. Android works without automation: registration, manual observation form, official Play search link, CSV/JSON import.
- **Profiles** — listing metadata by market, chart history per scope (rank 1 on top, gaps shown), rating & rating-count history, install threshold, versions/updates, publisher's other apps, verified cross-store counterparts, private notes, evidence.
- **Compare** — up to 5 listings, aligned window, explicit scope/market controls, non-comparable notes, CSV/JSON export with identifiers, provenance and timestamps (formula-injection safe).
- **Watchlists & alerts** — local alerts after ingestion for new chart entries, moves above a threshold, price changes and updates; deduplicated, with evidence.
- **Ads, creators & onboarding** — evidence library (paid / organic / unverified sponsorship), bulk import, ad-library search links, structured onboarding teardowns with multiple versions.
- **Keyword Lab** — term frequencies within your selected sample only; manual groups; user-owned keyword imports. No search volume is invented.
- **Research brief** — deterministic Markdown with source links plus a copyable analysis prompt. No AI API is called.
- **Monetization scenarios** — your inputs, low/base/high, visible formulas, excluded costs, no-data default, separate currencies.
- **Data & settings** — coverage by store/market/chart/date, ingestion runs + logs + dry run, sources manifest with live validation, market registry, taxonomy mapping, imports with preview, cross-store link review, backups, export.

## Hosted on GitHub (optional)

`.github/workflows/daily.yml` collects data every day on GitHub Actions and publishes the read-only public site to GitHub Pages — no computer needs to stay on. See [docs/GITHUB.md](docs/GITHUB.md). `npm run cloud:pull` + `npm run start:cloud` browse the cloud data locally.

## Documentation

- [docs/GITHUB.md](docs/GITHUB.md) — daily collection on GitHub Actions + GitHub Pages

- [docs/PROVIDERS.md](docs/PROVIDERS.md) — sources, terms notes, live validation status, fallbacks
- [docs/METHODOLOGY.md](docs/METHODOLOGY.md) — metric rules, labels, gaps and deltas
- [docs/IMPORTS.md](docs/IMPORTS.md) — templates and first-party mappings (samples in `samples/imports/`)
- [docs/SCHEDULING.md](docs/SCHEDULING.md) — Windows Task Scheduler and cron
- [docs/PUBLIC_EXPORT.md](docs/PUBLIC_EXPORT.md) — static read-only build and free-tier hosting notes

## Security model

- Binds to `127.0.0.1` by default; Host header is checked (DNS-rebinding protection).
- Write routes require a custom header (forces a CORS preflight that is never approved), reject foreign `Origin` and `Sec-Fetch-Site: cross-site`.
- All SQL uses bound parameters; inputs are validated with zod; content is rendered via React (escaped).
- The server only fetches allowlisted store hosts using URLs it builds from strictly parsed IDs; it never fetches user-supplied URLs.
- Imports are size-bounded (`IMPORT_MAX_BYTES`); CSV exports neutralize spreadsheet formulas.
- Private notes, evidence, teardowns, keyword data, first-party metrics, descriptions, raw HTTP cache and logs never enter the public export.

## Configuration

See `.env.example`. Key settings: `INGEST_MARKETS`, `CHART_DEPTH`, `APPLE_CHARTS`, per-provider budgets, `GOOGLE_PLAY_READER_ENABLED`, politeness intervals, `HTTP_CACHE_TTL_MIN`, `ALERT_RANK_THRESHOLD`, `IMPORT_MAX_BYTES`, `CACHE_RETENTION_DAYS`. Markets must also be enabled in **Data & settings → Markets** (US and IN on by default; GB and JP ready).
