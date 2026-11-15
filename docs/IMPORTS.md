# Imports

**Data & settings → Import** accepts CSV (RFC 4180, UTF-8, header row) or JSON (array of objects, or `{"rows": [...]}`), up to `IMPORT_MAX_BYTES` (default 5 MB) and 20,000 rows. Every import is previewed first: typed values, units, unknown columns, missing required columns, bad rows (with reasons) and duplicates (within the file and against earlier imports). Only valid, non-duplicate rows are committed.

Imported rows are labeled **User-supplied**, carry the import id, and are stored separately from direct observations (`provider = import`, `provenance = imported`). Deleting an import removes exactly the rows it created. History is never synthesized.

Samples for every template are in `samples/imports/` and are verified by `tests/samples.test.ts`.

| Template | Sample | Notes |
|---|---|---|
| `listings` | `listings.csv`, `listings.json` | Registers apps (tracked by default). Apple ids are numeric; Android ids are package names. |
| `observations` | `observations.csv` | Per-market metadata history: price/currency, rating, rating_count (ratings, not downloads), install_band (e.g. `1M+`, stored as lifetime lower bound), version, updated_at, has_ads, has_iap, source. |
| `chart_snapshots` | `chart_snapshots.csv` | One row per ranked entry; rows with the same platform/market/device/chart_type/category/snapshot_day form one snapshot. Ties allowed. `requested_depth` defaults to the max rank. This is the supported way to add Google Play chart history. |
| `keywords` | `keywords.csv` | Groups and optional positions/volume/difficulty from a source **you** have access to. `source` is required for any metric; `volume_unit` is required with `search_volume`; positions need `store_id`, `market`, `observed_day`. Private. |
| `evidence` | `evidence.csv` | `kind` ∈ paid_ad, organic_post, sponsorship_unverified, creator, screenshot, store_page, other. Metrics are recorded exactly as the source labels them, with scope. Private by default. |
| `teardowns` | `teardowns.csv` | Onboarding/paywall observations; multiple versions per app. Private. |
| `first_party` | `first_party_canonical.csv` | Canonical long format: `platform, store_id, day, metric, value, unit, market, source`. Private; never in the public export. |

## First-party mappings

| Mapping | Sample | Columns mapped |
|---|---|---|
| Google Play Console — statistics/installs | `play_console_installs.csv` | `Date`, `Package Name`, `Country`, `Daily Device Installs`, `Daily User Installs`, `Daily User Uninstalls`, `Install events`, `Active Device Installs` |
| App Store Connect — App Analytics | `app_store_connect_analytics.csv` | `Date`, `Impressions`, `Product Page Views`, `App Units`, `Sessions`, `Proceeds` (supply the Apple app id in the import options; the export has none) |

Unrecognized columns are listed as ignored, never guessed. If your console export differs, convert it to the canonical format.
