import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../db';

/** Consistent online backup using VACUUM INTO. Keeps the newest `keep` backups. */
export function backupDb(db: Db, dir: string, label: string, keep = 14): string {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${label}-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  const old = readdirSync(dir).filter((f) => f.startsWith(label + '-') && f.endsWith('.db')).sort().reverse().slice(keep);
  for (const f of old) rmSync(path.join(dir, f), { force: true });
  return file;
}
