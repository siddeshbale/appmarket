// Writes the sanitized, read-only public dataset next to the static build (dist-public/data/dataset.json).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from '../config';
import { migrate, openDb } from '../db';
import { buildPublicDataset } from '../io/exports';
import { parseArgs } from './args';

const f = parseArgs();
const cfg = loadConfig();
const db = openDb(cfg.dbPath);
migrate(db);
const out = path.resolve(ROOT, typeof f.out === 'string' ? f.out : 'dist-public');
const data = buildPublicDataset(db, { maxListings: Number(f['max-listings']) || 3000, historyDays: Number(f['history-days']) || 90 });
mkdirSync(path.join(out, 'data'), { recursive: true });
const json = JSON.stringify(data);
writeFileSync(path.join(out, 'data', 'dataset.json'), json);
writeFileSync(
  path.join(out, 'data', 'README.txt'),
  `App Market Radar public dataset (${data.mode.toUpperCase()}), generated ${data.generatedAt}.\nRead-only. Contains only redistributable store fields listed in the provider manifest.\nExcluded: private notes, non-public evidence, teardowns, first-party analytics, keywords, imports, descriptions, raw payloads, run logs.\n`,
);
console.log(`Public dataset (${data.mode}) → ${path.relative(ROOT, out)}/data/dataset.json  (${(json.length / 1024).toFixed(0)} KB, ${data.listings.length} listings, ${data.scopes.length} chart scopes)`);
db.close();
