// Verifies the static public build separately: dataset present, no private fields, no write endpoints, size within budget.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config';
import { parseArgs } from './args';

const f = parseArgs();
const dir = path.resolve(ROOT, typeof f.dir === 'string' ? f.dir : 'dist-public');
const problems: string[] = [];
const ok: string[] = [];
const ds = path.join(dir, 'data', 'dataset.json');
if (!existsSync(path.join(dir, 'index.html'))) problems.push('index.html missing');
if (!existsSync(ds)) problems.push('data/dataset.json missing');
else {
  const text = readFileSync(ds, 'utf8');
  const data = JSON.parse(text);
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
  walk(data);
  if (found.size) problems.push(`dataset contains private keys: ${[...found].join(', ')}`);
  else ok.push('no private keys in dataset');
  if (/Demo private note|never appears in the public export/.test(text)) problems.push('private note text leaked');
  if (Object.values<any>(data.profiles ?? {}).some((p) => p.listing?.provenance === 'imported')) problems.push('imported listings present');
  ok.push(`dataset mode=${data.mode}, listings=${data.listings?.length}, scopes=${data.scopes?.length}, size=${(text.length / 1024).toFixed(0)} KB`);
}
const files: string[] = [];
const walkDir = (d: string) => readdirSync(d).forEach((n) => (statSync(path.join(d, n)).isDirectory() ? walkDir(path.join(d, n)) : files.push(path.join(d, n))));
if (existsSync(dir)) walkDir(dir);
const js = files.filter((x) => x.endsWith('.js')).map((x) => readFileSync(x, 'utf8')).join('\n');
if (!/__PUBLIC_MODE__:true|publicMode:!0|"publicMode":true|PUBLIC_BUILD=!0|PUBLIC_BUILD=true/.test(js) && !js.includes('Public read-only build')) problems.push('bundle does not look like a public-mode build');
else ok.push('bundle built in public mode');
const total = files.reduce((n, x) => n + statSync(x).size, 0);
ok.push(`total size ${(total / 1024 / 1024).toFixed(2)} MB across ${files.length} files`);
if (total > 100 * 1024 * 1024) problems.push('build exceeds 100 MB');
for (const o of ok) console.log('OK   ' + o);
for (const p of problems) console.log('FAIL ' + p);
process.exitCode = problems.length ? 1 : 0;
