import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env loader (no dependency). Existing process.env values win. */
function loadDotEnv() {
  const p = path.join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const env = (k: string, d: string) => process.env[k] ?? d;
const num = (k: string, d: number, min = -Infinity, max = Infinity) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
};
const bool = (k: string, d: boolean) => (process.env[k] === undefined ? d : /^(1|true|yes|on)$/i.test(process.env[k]!));

export type AppMode = 'live' | 'demo';

export interface AppleChartSpec {
  device: 'iphone' | 'ipad';
  chartType: 'free' | 'paid' | 'grossing';
  genre: string; // 'all' or Apple genre id
}

export function parseAppleCharts(s: string): AppleChartSpec[] {
  const out: AppleChartSpec[] = [];
  for (const part of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [device, chartType, genre] = part.split(':');
    if (!['iphone', 'ipad'].includes(device) || !['free', 'paid', 'grossing'].includes(chartType)) continue;
    if (genre !== 'all' && !/^\d{4}$/.test(genre ?? '')) continue;
    out.push({ device: device as AppleChartSpec['device'], chartType: chartType as AppleChartSpec['chartType'], genre });
  }
  return out;
}

export function loadConfig() {
  const mode: AppMode = env('APP_MODE', 'live') === 'demo' ? 'demo' : 'live';
  const dbRel = mode === 'demo' ? env('DEMO_DB_PATH', 'data/demo.db') : env('DB_PATH', 'data/radar.db');
  return {
    mode,
    host: env('HOST', '127.0.0.1'),
    port: num('PORT', 5174, 1, 65535),
    dbPath: dbRel === ':memory:' ? ':memory:' : path.resolve(ROOT, dbRel),
    backupDir: path.resolve(ROOT, env('BACKUP_DIR', 'backups')),
    ingestMarkets: env('INGEST_MARKETS', 'us,in').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z]{2}$/.test(s)),
    chartDepth: num('CHART_DEPTH', 100, 1, 200),
    appleCharts: parseAppleCharts(
      env('APPLE_CHARTS', 'iphone:free:all,iphone:paid:all,iphone:grossing:all,iphone:free:6014,iphone:paid:6014,iphone:grossing:6014'),
    ),
    budgets: {
      'apple-itunes-rss': num('BUDGET_APPLE_RSS', 60, 0, 10000),
      'apple-rss-v2': num('BUDGET_APPLE_RSS', 60, 0, 10000),
      'itunes-lookup': num('BUDGET_ITUNES_LOOKUP', 40, 0, 10000),
      'google-play-details': num('BUDGET_GOOGLE_PLAY', 30, 0, 10000),
    } as Record<string, number>,
    googlePlayEnabled: bool('GOOGLE_PLAY_READER_ENABLED', true),
    minIntervalMs: {
      apple: num('APPLE_MIN_INTERVAL_MS', 1500, 0, 600000),
      google: num('GOOGLE_PLAY_MIN_INTERVAL_MS', 4000, 0, 600000),
    },
    httpTimeoutMs: num('HTTP_TIMEOUT_MS', 15000, 1000, 120000),
    cacheTtlMin: num('HTTP_CACHE_TTL_MIN', 360, 0, 100000),
    alertRankThreshold: num('ALERT_RANK_THRESHOLD', 10, 1, 200),
    importMaxBytes: num('IMPORT_MAX_BYTES', 5_000_000, 10_000, 50_000_000),
    cacheRetentionDays: num('CACHE_RETENTION_DAYS', 7, 0, 3650),
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
