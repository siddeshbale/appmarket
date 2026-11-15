// Cloud collection helpers used by the GitHub Actions workflow (and usable locally).
//   npm run cloud:pack    -- sanitized, compressed copy of the live DB -> data-branch/radar.db.gz
//   npm run cloud:restore -- data-branch/radar.db.gz -> data/radar.db (fresh DB if absent)
//   npm run cloud:pull    -- fetch the latest cloud DB from the git remote's `data` branch -> data/cloud.db
//
// The cloud DB is published in the repository, so it only ever contains collected public store data:
// private notes, non-public evidence, teardowns, keywords, imports, first-party metrics and the raw
// HTTP cache are removed before packing.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { loadConfig, ROOT } from '../config';
import { migrate, openDb } from '../db';
import { parseArgs } from './args';

const f = parseArgs();
const cmd = process.argv[2];
const cfg = loadConfig();
const branchDir = path.resolve(ROOT, typeof f.dir === 'string' ? f.dir : 'data-branch');
const packed = path.join(branchDir, 'radar.db.gz');

function removeDbFiles(file: string) {
  for (const s of ['', '-wal', '-shm']) if (existsSync(file + s)) rmSync(file + s);
}

export function sanitize(file: string) {
  const db = openDb(file);
  db.exec(`
    DELETE FROM http_cache;
    DELETE FROM private_notes;
    DELETE FROM evidence WHERE is_public = 0;
    DELETE FROM onboarding_teardowns;
    DELETE FROM keyword_observations;
    DELETE FROM keywords;
    DELETE FROM first_party_metrics;
    DELETE FROM imports;
    DELETE FROM listings WHERE provenance = 'imported'
      AND id NOT IN (SELECT listing_id FROM chart_entries)
      AND id NOT IN (SELECT listing_id FROM listing_observations);
    DELETE FROM watchlist_items;
    DELETE FROM watchlists;
    DELETE FROM alerts;
  `);
  db.exec('PRAGMA journal_mode = DELETE;');
  db.exec('VACUUM;');
  db.close();
}

if (cmd === 'pack') {
  if (cfg.mode !== 'live') throw new Error('cloud:pack only packs the live database');
  if (!existsSync(cfg.dbPath)) throw new Error(`No database at ${cfg.dbPath}`);
  mkdirSync(branchDir, { recursive: true });
  const tmp = path.join(branchDir, 'radar.tmp.db');
  removeDbFiles(tmp);
  const src = openDb(cfg.dbPath);
  migrate(src);
  src.prepare('VACUUM INTO ?').run(tmp);
  src.close();
  sanitize(tmp);
  const gz = gzipSync(readFileSync(tmp), { level: 9 });
  writeFileSync(packed, gz);
  removeDbFiles(tmp);
  writeFileSync(
    path.join(branchDir, 'README.md'),
    `# App Market Radar — collected data\n\nThis branch is rewritten by the daily workflow and holds only the latest database (\`radar.db.gz\`, SQLite, gzip).\nIt contains public store observations only — no private notes, evidence, imports or raw payloads.\n\nUpdated ${new Date().toISOString()}.\n`,
  );
  console.log(`Packed sanitized DB -> ${path.relative(ROOT, packed)} (${(gz.length / 1024).toFixed(0)} KB)`);
} else if (cmd === 'restore') {
  removeDbFiles(cfg.dbPath);
  mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
  if (existsSync(packed)) {
    writeFileSync(cfg.dbPath, gunzipSync(readFileSync(packed)));
    console.log(`Restored ${path.relative(ROOT, packed)} -> ${path.relative(ROOT, cfg.dbPath)} (${(statSync(cfg.dbPath).size / 1024).toFixed(0)} KB)`);
  } else console.log('No packed DB found; starting with a fresh database.');
  const db = openDb(cfg.dbPath);
  migrate(db);
  db.close();
} else if (cmd === 'pull') {
  const remote = typeof f.remote === 'string' ? f.remote : 'origin';
  execFileSync('git', ['fetch', remote, 'data'], { cwd: ROOT, stdio: 'inherit' });
  const buf = execFileSync('git', ['show', `${remote}/data:radar.db.gz`], { cwd: ROOT, maxBuffer: 1024 * 1024 * 1024 });
  const out = path.resolve(ROOT, typeof f.out === 'string' ? f.out : 'data/cloud.db');
  removeDbFiles(out);
  writeFileSync(out, gunzipSync(buf));
  console.log(`Pulled cloud DB -> ${path.relative(ROOT, out)}. Browse it with: npm run start:cloud`);
} else {
  console.error('Usage: tsx server/cli/cloud.ts pack|restore|pull [--dir data-branch] [--out data/cloud.db]');
  process.exit(1);
}
