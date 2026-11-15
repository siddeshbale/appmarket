# Scheduling daily collection

App Market Radar does **not** configure any scheduler on your machine. Every job is a plain npm script you can run manually:

```bash
npm run ingest -- --dry-run      # preview the exact requests (no network, no writes)
npm run ingest                   # collect now
npm run ingest -- --backup       # collect, then back up the database
npm run backup                   # backup only
```

Once a day is enough: Apple chart feeds refresh daily and repeated same-day runs are deduplicated (and mostly served from the 6 h cache).

## Windows — Task Scheduler

`scripts/scheduler/run-daily.ps1` runs `npm run ingest -- --backup` from the repo and appends to `logs\ingest-YYYY-MM-DD.log`.

Register (review first; runs as your user):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\scheduler\register-task.example.ps1
```

Or create it in the Task Scheduler UI: *Create Task* → Trigger *Daily 07:30* → Action *Start a program* `powershell.exe` with arguments
`-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\repo\scripts\scheduler\run-daily.ps1"` → enable *Run task as soon as possible after a scheduled start is missed*.

Remove: `Unregister-ScheduledTask -TaskName 'AppMarketRadar-DailyIngest'`.

## Linux / macOS — cron

```bash
chmod +x scripts/scheduler/run-daily.sh
crontab -e
# add (see scripts/scheduler/crontab.example):
30 7 * * * /path/to/app-market-radar/scripts/scheduler/run-daily.sh
```

Ensure cron can find Node 24 (`PATH=` line in the crontab or an absolute npm path).

## Exit codes and logs

`npm run ingest` exits `2` when every provider failed or was restricted, `0` otherwise (partial success is visible in **Data & settings → Ingestion**, with per-run logs). Logs never contain secrets — the app uses none.
