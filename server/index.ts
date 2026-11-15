import { buildApp } from './app';
import { loadConfig } from './config';

const cfg = loadConfig();
if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost' && cfg.host !== '::1') {
  console.warn(`WARNING: binding to ${cfg.host}. Write routes have no authentication; only do this on a trusted network.`);
}
const { app } = await buildApp({ config: cfg, logger: false });
await app.listen({ host: cfg.host, port: cfg.port });
console.log(`App Market Radar (${cfg.mode.toUpperCase()} mode) → http://${cfg.host === '::1' ? '[::1]' : cfg.host}:${cfg.port}`);
console.log(`Database: ${cfg.dbPath}`);
if (cfg.mode === 'demo') console.log('Demo mode: all records are FICTIONAL and stored in a separate database. Live ingestion is disabled.');
