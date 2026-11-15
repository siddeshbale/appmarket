# Running on GitHub (daily collection + public site)

`.github/workflows/daily.yml` turns the repository into a self-updating, read-only public site:

1. **Every day at 06:17 UTC** (and on demand via *Actions → Daily collection and publish → Run workflow*) it:
   - restores the database from the `data` branch,
   - collects today's Apple charts and metadata for `INGEST_MARKETS` (US and India by default) and reads registered Google Play packages,
   - saves a **sanitized** database back to the `data` branch (one commit, overwritten daily, so the repo stays small), plus a 30-day backup artifact,
   - builds the public site (`npm run export:public`), checks it (`npm run verify:public`) and deploys it to **GitHub Pages**.
2. If every source fails on a day, the previous data is kept and published unchanged; the run shows a warning.

## One-time setup

1. Push this repository to GitHub.
2. *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
3. *Actions* tab → enable workflows if prompted → run **Daily collection and publish** once manually.
4. The site URL appears in the run summary (`https://<user>.github.io/<repo>/`).

## What is public

Everything in a public repository is public: the code, the `data` branch database and the site. The cloud database is sanitized before it is saved — no private notes, non-public evidence, teardowns, keywords, imports, first-party metrics, watchlists or raw HTTP payloads. Those features stay in your **local** app only.

## Using the cloud data locally

```bash
npm run cloud:pull      # downloads the latest data branch DB to data/cloud.db
npm run start:cloud     # browse it at http://127.0.0.1:5174
```

Your local `data/radar.db` (with private notes etc.) is never overwritten by this.

## Tracking more apps in the cloud

The cloud collects charts plus apps registered in its database. To add Android packages or other tracked apps for daily reading, register them locally against the cloud copy and push it back:

```bash
npm run cloud:pull
# start with DB_PATH=data/cloud.db, track apps in the UI, stop the server, then:
DB_PATH=data/cloud.db npm run cloud:pack      # PowerShell: $env:DB_PATH='data/cloud.db'; npm run cloud:pack
```

then commit `data-branch/radar.db.gz` to the `data` branch (or ask Claude to do it). Changing markets/charts/depth: edit the `env:` of the *Collect* step or the defaults in `server/config.ts`.

## Limits and caveats

- **Cost:** free for public repositories (Actions minutes and Pages are free for public repos; a run takes a few minutes). Private repos get 2,000 free Actions minutes/month but GitHub Pages on a private repo requires a paid plan.
- **Pages limits:** sites up to ~1 GB, ~100 GB/month bandwidth (soft limits; check GitHub's current docs). The dataset is ~11 MB.
- **Inactivity:** GitHub may disable scheduled workflows in public repos after 60 days without repository activity and emails a warning; re-enable with one click in the Actions tab.
- **Timing:** scheduled runs can start late at busy times; a day is never skipped silently — check the Actions tab.
- **Google Play from GitHub's servers:** cloud IPs are more likely to be blocked than a home connection. If that happens, the run marks Google Play as *restricted*, Apple data continues normally, and you can disable the reader with `GOOGLE_PLAY_READER_ENABLED: 'false'` in the workflow.
- **Republishing:** the site republishes store fields (titles, developers, ranks, ratings). Review Apple's and Google's terms; the export is limited to the fields the source manifest marks as redistributable and keeps source links.
