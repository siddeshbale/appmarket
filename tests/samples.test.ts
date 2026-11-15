import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitImport, parseImport } from '../server/io/imports';
import { memDb } from './helpers';

const S = (f: string) => readFileSync(path.join(__dirname, '..', 'samples', 'imports', f), 'utf8');
const cases: [string, string, Record<string, any>?][] = [
  ['listings', 'listings.csv'],
  ['listings', 'listings.json'],
  ['observations', 'observations.csv'],
  ['chart_snapshots', 'chart_snapshots.csv'],
  ['keywords', 'keywords.csv'],
  ['evidence', 'evidence.csv'],
  ['teardowns', 'teardowns.csv'],
  ['first_party', 'first_party_canonical.csv'],
  ['first_party', 'play_console_installs.csv', { preset: 'play_console_installs' }],
  ['first_party', 'app_store_connect_analytics.csv', { preset: 'app_store_connect_analytics', platform: 'ios', storeId: '900000999' }],
];

describe('documented import samples', () => {
  for (const [kind, file, extra] of cases) {
    it(`${file} previews with no bad rows and commits`, () => {
      const db = memDb();
      const p = parseImport(db, { kind, format: file.endsWith('.json') ? 'json' : 'csv', content: S(file), ...extra });
      expect(p.missingColumns).toEqual([]);
      expect(p.rows.filter((r) => r.issues.length).map((r) => r.issues)).toEqual([]);
      expect(p.totals.ok).toBeGreaterThan(0);
      expect(commitImport(db, p, { filename: file }).written).toBe(p.totals.ok);
    });
  }
});
