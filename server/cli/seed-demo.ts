import { existsSync, rmSync } from 'node:fs';
import { loadConfig } from '../config';
import { migrate, openDb } from '../db';
import { seedDemo } from '../demo/seed';
import { suggestLinks } from '../repo/links';

const cfg = loadConfig();
if (cfg.mode !== 'demo') {
  console.error('Refusing to seed: APP_MODE must be "demo" (demo records are kept in a separate database). Use `npm run seed:demo`.');
  process.exit(1);
}
for (const suffix of ['', '-wal', '-shm']) if (existsSync(cfg.dbPath + suffix)) rmSync(cfg.dbPath + suffix);
const db = openDb(cfg.dbPath);
migrate(db);
const r = seedDemo(db);
const links = suggestLinks(db);
console.log(`Seeded FICTIONAL demo data into ${cfg.dbPath}: ${r.apps} apps × 2 stores, ${r.days} days of chart history, ${r.alerts} alerts, ${links.created} link suggestions.`);
db.close();
