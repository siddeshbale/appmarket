// Verifies the static public build separately: split dataset present and consistent, no private fields in ANY data
// file, no imported listings, bundle built in public mode, first-load size and total size within budget.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config';
import { parseArgs } from './args';

const f = parseArgs();
const dir = path.resolve(ROOT, typeof f.dir === 'string' ? f.dir : 'dist-public');
const problems: string[] = [];
const ok: string[] = [];
const files: string[] = [];
const walkDir = (d: string) => readdirSync(d).forEach((n) => (statSync(path.join(d, n)).isDirectory() ? walkDir(path.join(d, n)) : files.push(path.join(d, n))));
if (existsSync(dir)) walkDir(dir);

const dataDir = path.join(dir, 'data');
const indexPath = path.join(dataDir, 'index.json');
if (!existsSync(path.join(dir, 'index.html'))) problems.push('index.html missing');
if (!existsSync(indexPath)) problems.push('data/index.json missing');
else {
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const FORBIDDEN_KEYS = ['description', 'notes', 'body', 'teardowns', 'firstParty', 'first_party', 'log', 'evidence_json', 'local_path', 'search_volume', 'difficulty', 'summary_json'];
  const found = new Set<string>();
  const walk = (v: any) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        if (FORBIDDEN_KEYS.includes(k)) found.add(k);
        walk(x);
      }
  };
  const jsonFiles = files.filter((x) => x.startsWith(dataDir) && x.endsWith('.json'));
  let leaked = false;
  let imported = 0;
  for (const file of jsonFiles) {
    const text = readFileSync(file, 'utf8');
    walk(JSON.parse(text));
    if (/Demo private note|never appears in the public export/.test(text)) leaked = true;
    if (file.includes(`${path.sep}listings${path.sep}`) && JSON.parse(text).listing?.provenance === 'imported') imported++;
  }
  if (found.size) problems.push(`data files contain private keys: ${[...found].join(', ')}`);
  else ok.push(`no private keys in ${jsonFiles.length} data files`);
  if (leaked) problems.push('private note text leaked');
  if (imported) problems.push(`${imported} imported listings present`);
  const missingCharts = Object.values<string>(index.chartFiles ?? {}).filter((rel) => !existsSync(path.join(dataDir, rel)));
  if (missingCharts.length) problems.push(`missing chart files: ${missingCharts.join(', ')}`);
  const missingProfiles = (index.listings ?? []).filter((l: any) => !existsSync(path.join(dataDir, 'listings', `${l.id}.json`))).length;
  if (missingProfiles) problems.push(`${missingProfiles} catalog listings have no profile file`);
  const indexKb = statSync(indexPath).size / 1024;
  ok.push(`dataset mode=${index.mode}, listings=${index.listings?.length}, scopes=${index.scopes?.length}, index=${indexKb.toFixed(0)} KB`);
  if (indexKb > 2048) problems.push('index.json exceeds 2 MB (slow first load)');
}
const js = files.filter((x) => x.endsWith('.js')).map((x) => readFileSync(x, 'utf8')).join('\n');
if (!js.includes('Public read-only build')) problems.push('bundle does not look like a public-mode build');
else ok.push('bundle built in public mode');
const total = files.reduce((n, x) => n + statSync(x).size, 0);
ok.push(`total size ${(total / 1024 / 1024).toFixed(2)} MB across ${files.length} files`);
if (total > 900 * 1024 * 1024) problems.push('build exceeds 900 MB (GitHub Pages limit is ~1 GB)');
for (const o of ok) console.log('OK   ' + o);
for (const p of problems) console.log('FAIL ' + p);
process.exitCode = problems.length ? 1 : 0;
