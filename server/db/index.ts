import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { ROOT } from '../config';
import { seedReferenceData } from './reference';

export type Db = DatabaseSync;
export type Params = Record<string, SQLInputValue> | SQLInputValue[];

const MIGRATIONS_DIR = path.join(ROOT, 'server', 'db', 'migrations');

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

export function migrate(db: Db): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    tx(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, nowIso());
    });
    ran.push(f);
  }
  seedReferenceData(db);
  return ran;
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function all<T = any>(db: Db, sql: string, params: Params = {}): T[] {
  const st = db.prepare(sql);
  return (Array.isArray(params) ? st.all(...params) : st.all(params)) as T[];
}
export function get<T = any>(db: Db, sql: string, params: Params = {}): T | undefined {
  const st = db.prepare(sql);
  return (Array.isArray(params) ? st.get(...params) : st.get(params)) as T | undefined;
}
export function run(db: Db, sql: string, params: Params = {}) {
  const st = db.prepare(sql);
  return Array.isArray(params) ? st.run(...params) : st.run(params);
}

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const r = get<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', [key]);
  if (!r) return fallback;
  try {
    return JSON.parse(r.value) as T;
  } catch {
    return fallback;
  }
}
export function setSetting(db: Db, key: string, value: unknown) {
  run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
}
