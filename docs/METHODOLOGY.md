# Methodology

The same text is available in the app under **Methodology**.

## Labels

| Label | Meaning | Provenance values |
|---|---|---|
| **Observed** | Fetched by this tool from a public store source; has source URL and UTC timestamp | `observed` |
| **User-supplied** | Imported from your file or entered manually; stored separately, flagged with the import id | `imported`, `user` |
| **Modeled** | Monetization Scenarios output from your inputs | (computed, never stored on listings) |
| **Demo · fictional** | Demo-mode records in a separate database | `demo` |

## Scope

A chart scope is `(source, provenance, store, market, device, chart type, category, category scope)`. Ranks are compared only inside one scope. Category scope is:

- `all` — whole-store chart
- `category` — a category chart published by the source
- `filtered_subset` — an all-store chart filtered locally; ranks remain positions in the unfiltered chart. Labeled as such and never called a category chart.

## Snapshots and history

- Each snapshot stores the provider's own snapshot day (UTC), fetch time, requested depth, observed depth and status (`complete`, `partial`, `failed`, `empty`).
- Daily dedup: one snapshot per scope per provider day. A complete snapshot is kept on rerun; a failed/partial one may be replaced by a better fetch; a failure never overwrites a good snapshot.
- Per listing and day, chart presence is one of: `ranked`, `absent` (a comparable chart was fetched and the listing was outside the observed depth), `failed` (that day's fetch failed), `no_data` (nothing fetched). Only `absent` implies a drop-out. Charts and CSV exports leave non-ranked days blank.
- Metadata observations distinguish `available`, `unavailable` (not in that storefront), `failed`, `unknown`.

## Movement

- Delta = previous rank − current rank (positive = moved up), same scope only.
- 1-day uses the exact previous day. 7/30-day use the snapshot exactly N days earlier, or up to 2 days earlier if missing. Failed/empty snapshots are never used.
- No comparable snapshot → **insufficient history**, no delta.
- Not ranked earlier but ranked now: **first observed** (never seen in that scope) or **re-entry** (seen before). New-to-chart is not newly released.
- Ties (possible in imports) are kept; display order breaks ties by title.

## Metrics that are never inferred

Exact installs, downloads, sales, revenue, profit, retention, search volume, ad spend, ROAS, conversion. Specifically:

- Top grossing is a rank, not money.
- Rating-count growth is not download growth.
- Install thresholds (Play) are lifetime lower bounds.
- List price is not revenue; disclosed ads/IAP are flags, not amounts.

## Cross-store links

A suggestion requires a title match **and** an organization signal (normalized publisher name or shared identifier prefix such as `com.company`). Suggestions show their evidence and must be verified by you. Multiple candidates are flagged ambiguous. Cross-store ratings/ranks are never combined.

## Keyword Lab

Counts are within the selected tracked sample: listings using a term (document frequency), occurrences, and appearances in titles. “Title crowding” = listings in the sample with the term in their title ÷ sample size. It is not search volume or an official difficulty score. Positions, volume and difficulty appear only from your own imported data, labeled with their source and units.

## Monetization Scenarios

Formulas are shown on screen; inputs are yours (low/base/high); outputs are gross amounts before listed exclusions (store commission, taxes, refunds, costs). With no inputs the result is “No data”. Currencies are kept separate unless you supply a rate.

## Markets and taxonomy

Requests are always country-scoped; a US result is never shown as another market. Original store categories are preserved; the unified taxonomy is an editable many-to-one mapping used only for cross-store filtering. “All” means all tracked categories.
