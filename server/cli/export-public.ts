// Writes the sanitized, read-only public dataset next to the static build, split for fast loading:
//   data/index.json           meta, scopes, coverage, catalog listings (loaded on first visit)
//   data/charts/<n>.json      one file per chart scope (rows, movers, new-to-chart)
//   data/listings/<id>.json   one file per listing profile (loaded when a profile/compare is opened)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
const dataDir = path.join(out, 'data');
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(path.join(dataDir, 'charts'), { recursive: true });
mkdirSync(path.join(dataDir, 'listings'), { recursive: true });

let bytes = 0;
const write = (rel: string, v: unknown) => {
  const s = JSON.stringify(v);
  bytes += s.length;
  writeFileSync(path.join(dataDir, rel), s);
  return s.length;
};

const chartFiles: Record<string, string> = {};
Object.entries(data.charts).forEach(([scopeId, c], i) => {
  chartFiles[scopeId] = `charts/${i}.json`;
  write(chartFiles[scopeId], c);
});
for (const [id, p] of Object.entries<any>(data.profiles)) {
  // Days without any fetched chart carry no information; the chart draws them as gaps anyway.
  for (const c of p.charts) c.series = c.series.filter((pt: any) => pt.presence !== 'no_data');
  write(`listings/${id}.json`, p);
}
const { charts: _c, profiles: _p, ...rest } = data;
const indexSize = write('index.json', { ...rest, format: 2, chartFiles });
writeFileSync(
  path.join(dataDir, 'README.txt'),
  `App Market Radar public dataset (${data.mode.toUpperCase()}), generated ${data.generatedAt}.\nRead-only. Contains only redistributable store fields listed in the provider manifest.\nExcluded: private notes, non-public evidence, teardowns, first-party analytics, keywords, imports, descriptions, raw payloads, run logs.\n`,
);
console.log(
  `Public dataset (${data.mode}) → ${path.relative(ROOT, dataDir)}/  index ${(indexSize / 1024).toFixed(0)} KB, ` +
    `${Object.keys(chartFiles).length} chart files, ${Object.keys(data.profiles).length} listing files, total ${(bytes / 1024).toFixed(0)} KB ` +
    `(${data.listings.length} listings, ${data.scopes.length} chart scopes)`,
);
db.close();
