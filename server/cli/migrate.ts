import { loadConfig } from '../config';
import { migrate, openDb } from '../db';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const ran = migrate(db);
console.log(`[${cfg.mode}] ${cfg.dbPath}: ${ran.length ? `applied ${ran.join(', ')}` : 'schema up to date'}`);
db.close();
