import { loadConfig } from '../config';
import { migrate, openDb } from '../db';
import { backupDb } from '../lib/backup';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
migrate(db);
console.log(`Backup written: ${backupDb(db, cfg.backupDir, cfg.mode)}`);
db.close();
