# Once-daily collection for App Market Radar (Windows). Invoked by Task Scheduler; safe to run manually.
# Writes a log to logs\ingest-YYYY-MM-DD.log and a database backup to backups\.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
New-Item -ItemType Directory -Force -Path (Join-Path $repo 'logs') | Out-Null
$log = Join-Path $repo ("logs\ingest-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
& npm run ingest -- --backup *>> $log
exit $LASTEXITCODE
