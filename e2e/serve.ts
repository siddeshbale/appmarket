// Starts an isolated demo server for the browser smoke test (separate DB file, separate port).
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

process.env.APP_MODE = 'demo';
process.env.DEMO_DB_PATH = 'data/e2e-demo.db';
process.env.PORT = process.env.E2E_PORT ?? '5199';
const { loadConfig, ROOT } = await import('../server/config');
const cfg = loadConfig();
for (const s of ['', '-wal', '-shm']) if (existsSync(cfg.dbPath + s)) rmSync(cfg.dbPath + s);
const { migrate, openDb } = await import('../server/db');
const { seedDemo } = await import('../server/demo/seed');
const db = openDb(cfg.dbPath);
migrate(db);
seedDemo(db);
db.close();
if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('Run `npm run build` first.');
  process.exit(1);
}
const { buildApp } = await import('../server/app');
const { app } = await buildApp({ config: cfg });
await app.listen({ host: '127.0.0.1', port: cfg.port });
console.log(`e2e demo server on http://127.0.0.1:${cfg.port}`);
