// Polite HTTP client used by every provider: host allowlist, per-provider budget, concurrency cap,
// minimum spacing, timeouts, cache, exponential backoff with jitter, Retry-After, and error classification.
// It never follows redirects to non-allowlisted hosts and never logs query secrets (there are none by design).

import type { ErrorClass } from '../../shared/types';
import type { Db } from '../db';
import { get, nowIso, run } from '../db';

export const ALLOWED_HOSTS = new Set(['rss.marketingtools.apple.com', 'itunes.apple.com', 'play.google.com']);

export class ProviderError extends Error {
  constructor(
    public errorClass: ErrorClass,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface FetchPolicy {
  provider: string;
  budget: number;
  minIntervalMs: number;
  timeoutMs: number;
  maxRetries: number;
  maxConcurrency: number;
  cacheTtlMin: number;
  userAgent?: string;
  acceptLanguage?: string;
}

export interface HttpLog {
  (line: string): void;
}

/** Abstract transport so tests can inject fixtures and failure modes. */
export type Transport = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  url?: string;
}>;

export const defaultTransport: Transport = async (url, init) => {
  const res = await fetch(url, { headers: init.headers, signal: init.signal, redirect: 'manual' });
  return res;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function classifyStatus(status: number, body: string): ErrorClass | null {
  if (status >= 200 && status < 300) {
    if (/unusual traffic|captcha|recaptcha/i.test(body.slice(0, 20000)) && body.length < 200000) return 'restricted';
    return null;
  }
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403 || status === 451) return 'restricted';
  if (status === 404 || status === 410) return 'not_found';
  if (status >= 300 && status < 400) return 'restricted'; // we do not follow redirects (could be sign-in / consent walls)
  if (status >= 500) return 'server_error';
  return 'client_error';
}

export function parseRetryAfter(v: string | null, now = Date.now()): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v.trim())) return Number(v.trim()) * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

export class PoliteClient {
  used = 0;
  private lastStart = 0;
  private active = 0;
  private waiters: (() => void)[] = [];
  stopped: ProviderError | null = null;

  constructor(
    public policy: FetchPolicy,
    private db: Db | null,
    private log: HttpLog = () => {},
    private transport: Transport = defaultTransport,
    private sleeper: (ms: number) => Promise<void> = sleep,
  ) {}

  private async acquire() {
    if (this.active >= this.policy.maxConcurrency) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    const wait = this.lastStart + this.policy.minIntervalMs - Date.now();
    if (wait > 0) await this.sleeper(wait);
    this.lastStart = Date.now();
  }
  private release() {
    this.active--;
    this.waiters.shift()?.();
  }

  /** GET text. Throws ProviderError. Stops the provider permanently for this run on access restrictions. */
  async getText(url: string, opts: { useCache?: boolean } = {}): Promise<{ body: string; status: number; fromCache: boolean; fetchedAt: string }> {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new ProviderError('client_error', `Host not allowlisted: ${u.hostname}`);
    if (this.stopped) throw this.stopped;
    if (opts.useCache !== false && this.db && this.policy.cacheTtlMin > 0) {
      const c = get<{ body: string; status: number; fetched_at: string }>(this.db, 'SELECT body, status, fetched_at FROM http_cache WHERE url = ?', [url]);
      if (c && Date.now() - Date.parse(c.fetched_at) < this.policy.cacheTtlMin * 60000) {
        this.log(`cache hit ${redact(url)}`);
        return { body: c.body, status: c.status, fromCache: true, fetchedAt: c.fetched_at };
      }
    }
    let attempt = 0;
    for (;;) {
      if (this.used >= this.policy.budget) {
        throw new ProviderError('budget_exhausted', `Request budget of ${this.policy.budget} exhausted for ${this.policy.provider}`);
      }
      this.used++;
      await this.acquire();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.policy.timeoutMs);
      let status = 0;
      let body: string;
      let retryAfter: number | null = null;
      let cls: ErrorClass | null;
      try {
        const res = await this.transport(url, {
          headers: {
            'User-Agent': this.policy.userAgent ?? 'AppMarketRadar/0.1 (local research tool)',
            Accept: 'application/json, text/html;q=0.9, */*;q=0.5',
            ...(this.policy.acceptLanguage ? { 'Accept-Language': this.policy.acceptLanguage } : {}),
          },
          signal: ctrl.signal,
        });
        status = res.status;
        body = await res.text();
        retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        cls = classifyStatus(status, body);
      } catch (e: any) {
        cls = e?.name === 'AbortError' ? 'timeout' : 'network';
        body = String(e?.message ?? e);
      } finally {
        clearTimeout(timer);
        this.release();
      }
      this.log(`GET ${redact(url)} -> ${status || cls} (attempt ${attempt + 1})`);
      if (!cls) {
        if (this.db) {
          run(this.db, 'INSERT INTO http_cache (url, provider, fetched_at, status, body) VALUES (?, ?, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET fetched_at=excluded.fetched_at, status=excluded.status, body=excluded.body', [
            url,
            this.policy.provider,
            nowIso(),
            status,
            body,
          ]);
        }
        return { body, status, fromCache: false, fetchedAt: nowIso() };
      }
      if (cls === 'restricted') {
        this.stopped = new ProviderError('restricted', `Access restricted (HTTP ${status}); stopping ${this.policy.provider} for this run`, status);
        throw this.stopped;
      }
      const transient = cls === 'rate_limited' || cls === 'server_error' || cls === 'timeout' || cls === 'network';
      if (!transient || attempt >= this.policy.maxRetries) {
        if (cls === 'rate_limited') this.stopped = new ProviderError('rate_limited', `Rate limited by source; stopping ${this.policy.provider} for this run`, status);
        throw new ProviderError(cls, `${cls}${status ? ` (HTTP ${status})` : ''}: ${redact(url)}`, status);
      }
      const backoff = Math.min(60000, 1000 * 2 ** attempt);
      const jitter = Math.floor(Math.random() * 500);
      const wait = retryAfter !== null ? Math.min(retryAfter, 120000) : backoff + jitter;
      this.log(`  retrying in ${wait}ms (${cls})`);
      await this.sleeper(wait);
      attempt++;
    }
  }
}

/** Remove query values that could ever carry user text (search terms) from logs. */
export function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has('term')) u.searchParams.set('term', '…');
    return u.toString();
  } catch {
    return '[invalid url]';
  }
}
