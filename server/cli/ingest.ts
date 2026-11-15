// Manual / scheduled collection entry point.
//   npm run ingest                       -> default providers for INGEST_MARKETS
//   npm run ingest -- --dry-run          -> scope preview, no network, no writes
//   npm run ingest -- --markets us --providers apple-itunes-rss,itunes-lookup --depth 50
import { loadConfig, parseAppleCharts } from '../config';
import { migrate, openDb } from '../db';
import { runIngestion } from '../ingest/run';
import { backupDb } from '../lib/backup';
import { list, parseArgs } from './args';

const f = parseArgs();
const cfg = loadConfig();
const db = openDb(cfg.dbPath);
migrate(db);
const quiet = !!f.quiet;
const res = await runIngestion(db, cfg, {
  dryRun: !!f['dry-run'],
  markets: list(f.markets),
  providers: list(f.providers),
  depth: f.depth ? Number(f.depth) : undefined,
  charts: typeof f.charts === 'string' ? parseAppleCharts(f.charts) : undefined,
  log: quiet ? undefined : (l) => console.log(l),
});
if (res.skippedMarkets.length) console.log(`Skipped markets (not enabled in registry): ${res.skippedMarkets.join(', ')}`);
console.log(`\n${res.dryRun ? 'DRY RUN — scope preview' : 'Ingestion summary'} for markets: ${res.markets.join(', ') || '(none)'}`);
for (const p of res.providers) {
  console.log(`- ${p.provider}: ${p.status}; requests=${p.requests} items=${p.items}${p.errors.length ? ` errors=${p.errors.length}` : ''}${p.runId ? ` (run #${p.runId})` : ''}`);
  for (const e of p.errors.slice(0, 10)) console.log(`    ${e.scope}: ${e.errorClass} — ${e.message}`);
  if (p.planned) for (const u of p.planned) console.log(`    would fetch: ${u}`);
}
if (!res.dryRun) {
  console.log(`Alerts created: ${res.alerts}`);
  if (f.backup) console.log(`Backup: ${backupDb(db, cfg.backupDir, cfg.mode)}`);
}
db.close();
const failed = res.providers.every((p) => p.status === 'failed' || p.status === 'restricted');
process.exitCode = failed && !res.dryRun ? 2 : 0;
