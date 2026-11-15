// Ingestion orchestrator. Each provider runs independently with its own run record, budget and error state,
// so one source failing never breaks the others or discards previously verified data.
import type { ChartType } from '../../shared/types';
import type { AppConfig, AppleChartSpec } from '../config';
import { all, nowIso, run, todayUtc, type Db } from '../db';
import { PoliteClient, ProviderError, type Transport } from '../http/client';
import { fetchLegacyChart, fetchV2Chart, legacyChartUrl, lookupApple, v2ChartUrl } from '../providers/apple';
import { fetchPlayDetails, playDetailsUrl } from '../providers/googlePlay';
import { MalformedPayloadError } from '../providers/types';
import { listingIdsNeedingLookup, recordFailedSnapshot, storeChart, storeListingObservation } from '../repo/store';
import { generateAlerts } from './alerts';

export interface IngestOptions {
  dryRun?: boolean;
  markets?: string[];
  providers?: string[];
  depth?: number;
  charts?: AppleChartSpec[];
  transport?: Transport;
  sleeper?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export interface ProviderRunSummary {
  provider: string;
  runId: number | null;
  status: string;
  requests: number;
  items: number;
  errors: { scope: string; errorClass: string; message: string }[];
  planned?: string[];
}

export const DEFAULT_PROVIDERS = ['apple-itunes-rss', 'itunes-lookup', 'google-play-details'];

class RunLog {
  lines: string[] = [];
  constructor(private sink?: (l: string) => void) {}
  add = (l: string) => {
    const line = `${new Date().toISOString()} ${l}`;
    this.lines.push(line);
    if (this.lines.length > 2000) this.lines.shift();
    this.sink?.(line);
  };
}

function startRun(db: Db, provider: string, job: string, scope: unknown) {
  const r = run(db, 'INSERT INTO ingestion_runs (provider, job, scope_json, started_at, status) VALUES (?, ?, ?, ?, ?)', [provider, job, JSON.stringify(scope), nowIso(), 'running']);
  return Number(r.lastInsertRowid);
}
function finishRun(db: Db, id: number, s: ProviderRunSummary, log: RunLog) {
  const first = s.errors[0];
  run(db, 'UPDATE ingestion_runs SET finished_at = ?, status = ?, requests = ?, items = ?, error_class = ?, message = ?, log = ? WHERE id = ?', [
    nowIso(), s.status, s.requests, s.items, first?.errorClass ?? null,
    s.errors.length ? `${s.errors.length} error(s); first: ${first.scope}: ${first.message}`.slice(0, 1000) : null,
    log.lines.join('\n').slice(-200000), id,
  ]);
}
function statusFrom(ok: number, failed: number, restricted: boolean): string {
  if (restricted) return 'restricted';
  if (failed === 0) return 'success';
  if (ok === 0) return 'failed';
  return 'partial';
}
function errInfo(e: unknown): { errorClass: string; message: string } {
  if (e instanceof ProviderError) return { errorClass: e.errorClass, message: e.message };
  if (e instanceof MalformedPayloadError) return { errorClass: 'malformed', message: e.message };
  return { errorClass: 'network', message: String((e as any)?.message ?? e).slice(0, 300) };
}

export function enabledMarkets(db: Db, requested: string[]): { ok: string[]; skipped: string[] } {
  const enabled = new Set(all<{ code: string }>(db, 'SELECT code FROM markets WHERE enabled = 1').map((r) => r.code));
  return { ok: requested.filter((m) => enabled.has(m)), skipped: requested.filter((m) => !enabled.has(m)) };
}

export async function runIngestion(db: Db, cfg: AppConfig, opts: IngestOptions = {}): Promise<{ dryRun: boolean; markets: string[]; skippedMarkets: string[]; providers: ProviderRunSummary[]; alerts: number }> {
  if (cfg.mode === 'demo') throw new Error('Live ingestion is disabled in demo mode (demo data is never mixed with live data).');
  const providers = opts.providers?.length ? opts.providers : DEFAULT_PROVIDERS;
  const { ok: markets, skipped } = enabledMarkets(db, opts.markets?.length ? opts.markets : cfg.ingestMarkets);
  const depth = Math.max(1, Math.min(200, opts.depth ?? cfg.chartDepth));
  const charts = opts.charts ?? cfg.appleCharts;
  const out: ProviderRunSummary[] = [];
  const mkClient = (provider: string, log: RunLog, kind: 'apple' | 'google') =>
    new PoliteClient(
      {
        provider,
        budget: cfg.budgets[provider] ?? 20,
        minIntervalMs: kind === 'apple' ? cfg.minIntervalMs.apple : cfg.minIntervalMs.google,
        timeoutMs: cfg.httpTimeoutMs,
        maxRetries: 3,
        maxConcurrency: 1,
        cacheTtlMin: cfg.cacheTtlMin,
        acceptLanguage: 'en-US,en;q=0.8',
      },
      db,
      log.add,
      opts.transport,
      opts.sleeper,
    );

  const day = todayUtc();

  // ---------- Dry run: scope preview only, no network, no writes ----------
  if (opts.dryRun) {
    for (const p of providers) {
      const planned: string[] = [];
      if (p === 'apple-itunes-rss') for (const m of markets) for (const c of charts) planned.push(legacyChartUrl(m, c.device, c.chartType, c.genre, depth));
      if (p === 'apple-rss-v2') for (const m of markets) for (const t of ['free', 'paid'] as const) planned.push(v2ChartUrl(m, t, depth));
      if (p === 'itunes-lookup') for (const m of markets) planned.push(`lookup batches (≤100 ids each) for ${m}: listings seen in today's charts + tracked; budget ${cfg.budgets['itunes-lookup']}`);
      if (p === 'google-play-details') {
        if (!cfg.googlePlayEnabled) planned.push('disabled (GOOGLE_PLAY_READER_ENABLED=false)');
        else {
          const pk = all<{ store_id: string }>(db, "SELECT store_id FROM listings WHERE platform='android' AND tracked=1 AND provenance != 'demo' LIMIT 200");
          for (const m of markets) for (const x of pk) planned.push(playDetailsUrl(x.store_id, m));
        }
      }
      out.push({ provider: p, runId: null, status: 'dry_run', requests: 0, items: 0, errors: [], planned });
    }
    return { dryRun: true, markets, skippedMarkets: skipped, providers: out, alerts: 0 };
  }

  const runIds: number[] = [];

  // ---------- Apple charts (legacy feeds) ----------
  if (providers.includes('apple-itunes-rss')) {
    const log = new RunLog(opts.log);
    const runId = startRun(db, 'apple-itunes-rss', 'charts', { markets, charts, depth });
    runIds.push(runId);
    const client = mkClient('apple-itunes-rss', log, 'apple');
    const s: ProviderRunSummary = { provider: 'apple-itunes-rss', runId, status: 'running', requests: 0, items: 0, errors: [] };
    let okCount = 0;
    for (const m of markets) {
      for (const c of charts) {
        const scope = `${m}/${c.device}/${c.chartType}/${c.genre}`;
        const url = legacyChartUrl(m, c.device, c.chartType, c.genre, depth);
        try {
          const chart = await fetchLegacyChart(client, m, c.device, c.chartType as ChartType, c.genre, depth);
          const r = storeChart(db, chart, { provenance: 'observed', runId });
          if (r.skipped) log.add(`${scope}: ${r.reason}`);
          else log.add(`${scope}: stored ${chart.entries.length}/${depth} entries for ${chart.snapshotDay}`);
          s.items += chart.entries.length;
          okCount++;
        } catch (e) {
          const info = errInfo(e);
          s.errors.push({ scope, ...info });
          log.add(`${scope}: ${info.errorClass} — ${info.message}`);
          recordFailedSnapshot(db, {
            provider: 'apple-itunes-rss', provenance: 'observed', platform: 'ios', market: m, device: c.device, chartType: c.chartType, category: c.genre,
            categoryScope: c.genre === 'all' ? 'all' : 'category', snapshotDay: day, requestedDepth: depth, sourceUrl: url, errorClass: info.errorClass, runId,
          });
        }
      }
    }
    s.requests = client.used;
    s.status = statusFrom(okCount, s.errors.length, !!client.stopped && client.stopped.errorClass === 'restricted');
    finishRun(db, runId, s, log);
    out.push(s);
  }

  // ---------- Apple RSS v2 (optional) ----------
  if (providers.includes('apple-rss-v2')) {
    const log = new RunLog(opts.log);
    const runId = startRun(db, 'apple-rss-v2', 'charts', { markets, depth });
    runIds.push(runId);
    const client = mkClient('apple-rss-v2', log, 'apple');
    const s: ProviderRunSummary = { provider: 'apple-rss-v2', runId, status: 'running', requests: 0, items: 0, errors: [] };
    let okCount = 0;
    const d2 = [10, 25, 50, 100].find((x) => x >= Math.min(depth, 100)) ?? 100;
    for (const m of markets) {
      for (const t of ['free', 'paid'] as const) {
        const scope = `${m}/unspecified/${t}/all`;
        try {
          const chart = await fetchV2Chart(client, m, t, d2);
          storeChart(db, chart, { provenance: 'observed', runId });
          s.items += chart.entries.length;
          okCount++;
          log.add(`${scope}: ${chart.entries.length} entries`);
        } catch (e) {
          const info = errInfo(e);
          s.errors.push({ scope, ...info });
          log.add(`${scope}: ${info.errorClass} — ${info.message}`);
          recordFailedSnapshot(db, {
            provider: 'apple-rss-v2', provenance: 'observed', platform: 'ios', market: m, device: 'unspecified', chartType: t, category: 'all', categoryScope: 'all',
            snapshotDay: day, requestedDepth: d2, sourceUrl: v2ChartUrl(m, t, d2), errorClass: info.errorClass, runId,
          });
        }
      }
    }
    s.requests = client.used;
    s.status = statusFrom(okCount, s.errors.length, client.stopped?.errorClass === 'restricted');
    finishRun(db, runId, s, log);
    out.push(s);
  }

  // ---------- iTunes lookup for listings seen in charts / tracked ----------
  if (providers.includes('itunes-lookup')) {
    const log = new RunLog(opts.log);
    const runId = startRun(db, 'itunes-lookup', 'metadata', { markets });
    runIds.push(runId);
    const client = mkClient('itunes-lookup', log, 'apple');
    const s: ProviderRunSummary = { provider: 'itunes-lookup', runId, status: 'running', requests: 0, items: 0, errors: [] };
    let okCount = 0;
    for (const m of markets) {
      const remaining = Math.max(0, (cfg.budgets['itunes-lookup'] ?? 0) - client.used);
      const ids = listingIdsNeedingLookup(db, m, day, remaining * 100);
      if (!ids.length) {
        log.add(`${m}: nothing to look up`);
        continue;
      }
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        try {
          const rows = await lookupApple(client, batch, m);
          for (const n of rows) storeListingObservation(db, n, { provider: 'itunes-lookup', provenance: 'observed', runId, snapshotDay: day });
          s.items += rows.length;
          okCount++;
          log.add(`${m}: looked up ${batch.length} ids (${rows.filter((r) => r.availability === 'unavailable').length} unavailable in this storefront)`);
        } catch (e) {
          const info = errInfo(e);
          s.errors.push({ scope: `${m} batch ${i / 100 + 1}`, ...info });
          log.add(`${m}: ${info.errorClass} — ${info.message}`);
          if (client.stopped || info.errorClass === 'budget_exhausted') break;
        }
      }
    }
    s.requests = client.used;
    s.status = okCount === 0 && s.errors.length === 0 ? 'skipped' : statusFrom(okCount, s.errors.length, client.stopped?.errorClass === 'restricted');
    finishRun(db, runId, s, log);
    out.push(s);
  }

  // ---------- Google Play detail pages for registered packages ----------
  if (providers.includes('google-play-details')) {
    const log = new RunLog(opts.log);
    const runId = startRun(db, 'google-play-details', 'metadata', { markets });
    runIds.push(runId);
    const s: ProviderRunSummary = { provider: 'google-play-details', runId, status: 'running', requests: 0, items: 0, errors: [] };
    if (!cfg.googlePlayEnabled) {
      s.status = 'skipped';
      s.errors.push({ scope: '*', errorClass: 'disabled', message: 'GOOGLE_PLAY_READER_ENABLED=false' });
      log.add('reader disabled by configuration');
    } else {
      const client = mkClient('google-play-details', log, 'google');
      const pkgs = all<{ store_id: string }>(db, "SELECT store_id FROM listings WHERE platform='android' AND tracked=1 AND provenance != 'demo' ORDER BY id");
      let okCount = 0;
      outer: for (const m of markets) {
        for (const p of pkgs) {
          try {
            const n = await fetchPlayDetails(client, p.store_id, m, 'en');
            storeListingObservation(db, n, { provider: 'google-play-details', provenance: 'observed', runId, snapshotDay: day });
            s.items++;
            okCount++;
          } catch (e) {
            const info = errInfo(e);
            s.errors.push({ scope: `${m}/${p.store_id}`, ...info });
            log.add(`${m}/${p.store_id}: ${info.errorClass} — ${info.message}`);
            if (client.stopped || info.errorClass === 'budget_exhausted') break outer;
          }
        }
      }
      s.requests = client.used;
      s.status = pkgs.length === 0 ? 'skipped' : statusFrom(okCount, s.errors.length, client.stopped?.errorClass === 'restricted');
      if (pkgs.length === 0) log.add('no registered Android packages to read');
    }
    finishRun(db, runId, s, log);
    out.push(s);
  }

  // Alerts only after successful (or partially successful) ingestion; based solely on verified, comparable data.
  const anyOk = out.some((s) => s.status === 'success' || s.status === 'partial');
  const alerts = anyOk ? generateAlerts(db, cfg.alertRankThreshold, runIds[0] ?? null) : 0;
  // housekeeping: prune old raw cache (observations are never auto-deleted)
  run(db, "DELETE FROM http_cache WHERE fetched_at < datetime('now', ?)", [`-${cfg.cacheRetentionDays} days`]);
  return { dryRun: false, markets, skippedMarkets: skipped, providers: out, alerts };
}
