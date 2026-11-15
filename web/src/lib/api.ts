// API client. In local mode it calls the loopback Fastify API. In the public static build it serves a
// read-only subset from the sanitized dataset.json and never calls write endpoints.
import { addDays, dayRange } from '../../../shared/ranks';

export const PUBLIC_MODE = import.meta.env.VITE_PUBLIC_MODE === 'true';
export const PUBLIC_BUILD = PUBLIC_MODE; // marker used by verify:public
if (PUBLIC_MODE) (globalThis as any).__radar = 'Public read-only build';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function http<T>(method: string, url: string, body?: unknown): Promise<T> {
  if (PUBLIC_MODE) throw new ApiError(405, 'This is the public read-only build. Run the app locally to make changes.');
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json', 'x-radar-request': '1' } : method === 'GET' ? {} : { 'x-radar-request': '1' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? String(data));
  return data as T;
}

// ---------------- public dataset adapter ----------------
// The public dataset is split: index.json (loaded once) + chart and listing files fetched on demand.
const fileCache = new Map<string, Promise<any>>();
function dataFile(rel: string, missing: string): Promise<any> {
  let p = fileCache.get(rel);
  if (!p) {
    p = fetch('./data/' + rel).then((r) => {
      if (!r.ok) throw new ApiError(404, missing);
      return r.json();
    });
    p.catch(() => fileCache.delete(rel));
    fileCache.set(rel, p);
  }
  return p;
}
export function dataset(): Promise<any> {
  return dataFile('index.json', 'Public dataset missing');
}
const profileFile = (id: number | string) => dataFile('listings/' + Number(id) + '.json', 'Listing not in the public dataset');

async function publicGet(path: string, q: URLSearchParams, d: any): Promise<any> {
  const listings = new Map<number, any>(d.listings.map((l: any) => [l.id, l]));
  const hydrate = (r: any) => ({ ...listings.get(r.id), ...r });
  if (path === '/api/meta')
    return { mode: d.mode, publicMode: true, version: '0.1.0', today: d.window.to, markets: d.markets, unified: d.unified, providers: d.providers, config: {}, generatedAt: d.generatedAt };
  if (path === '/api/scopes') return d.scopes;
  if (path === '/api/scopes/default') {
    const s = d.scopes.find((x: any) => x.market === 'us' && x.device === 'iphone' && x.chartType === 'free' && x.category === 'all') ?? d.scopes[0];
    return { scopeId: s?.id ?? null };
  }
  const chartRel = d.chartFiles?.[q.get('scope') ?? ''];
  const c = (path === '/api/charts' || path === '/api/movers' || path === '/api/new-to-chart') && chartRel ? await dataFile(chartRel, 'Chart not in the public dataset') : null;
  if (path === '/api/charts') {
    if (!c) return { day: null, rows: [], snapshot: null };
    let rows = c.rows.map(hydrate);
    const u = q.get('unified');
    const pt = q.get('priceType');
    const ra = q.get('releasedAfter');
    const rb = q.get('releasedBefore');
    if (u) rows = rows.filter((r: any) => r.unified_slug === u || (u === 'games' && r.is_game));
    if (pt === 'free') rows = rows.filter((r: any) => r.price === 0);
    if (pt === 'paid') rows = rows.filter((r: any) => (r.price ?? 0) > 0);
    if (ra) rows = rows.filter((r: any) => r.release_date && r.release_date >= ra);
    if (rb) rows = rows.filter((r: any) => r.release_date && r.release_date <= rb);
    return { scope: c.scope, scopeId: c.scope.id, day: c.day, snapshot: c.snapshot, rows, filteredSubset: !!(u || pt || ra || rb) };
  }
  if (path === '/api/movers') {
    if (!c) return { day: null, rows: [], insufficient: true };
    const m = q.get('window') === '30' ? c.movers30 : c.movers7;
    return { scopeId: c.scope.id, day: c.day, window: Number(q.get('window') ?? 7), comparedDay: m.comparedDay, insufficient: m.insufficient, rows: m.rows.map(hydrate), dropped: m.dropped.map(hydrate) };
  }
  if (path === '/api/new-to-chart') {
    if (!c) return { day: null, rows: [] };
    return { scopeId: c.scope.id, day: c.day, comparedDay: c.newToChart.comparedDay, rows: c.newToChart.rows.map(hydrate) };
  }
  if (path === '/api/catalog') {
    let rows = d.listings as any[];
    const term = (q.get('q') ?? '').toLowerCase();
    if (term) rows = rows.filter((l) => l.title.toLowerCase().includes(term) || (l.publisher_name ?? '').toLowerCase().includes(term) || l.store_id === q.get('q'));
    if (q.get('platform')) rows = rows.filter((l) => l.platform === q.get('platform'));
    if (q.get('market')) rows = rows.filter((l) => l.markets.includes(q.get('market')));
    if (q.get('kind') === 'games') rows = rows.filter((l) => l.is_game);
    if (q.get('kind') === 'apps') rows = rows.filter((l) => !l.is_game);
    if (q.get('unified')) rows = rows.filter((l) => l.unified_slug === q.get('unified') || (q.get('unified') === 'games' && l.is_game));
    if (q.get('priceType') === 'free') rows = rows.filter((l) => l.price === 0);
    if (q.get('priceType') === 'paid') rows = rows.filter((l) => (l.price ?? 0) > 0);
    if (q.get('releasedAfter')) rows = rows.filter((l) => l.release_date && l.release_date >= q.get('releasedAfter')!);
    if (q.get('releasedBefore')) rows = rows.filter((l) => l.release_date && l.release_date <= q.get('releasedBefore')!);
    const sort = q.get('sort') ?? 'title';
    const key: Record<string, string> = { title: 'title', publisher: 'publisher_name', rating: 'rating', ratings: 'rating_count', release: 'release_date', price: 'price' };
    const k = key[sort] ?? 'title';
    const dir = q.get('dir') === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => (a[k] == null ? 1 : b[k] == null ? -1 : a[k] > b[k] ? dir : a[k] < b[k] ? -dir : 0));
    const pageSize = Number(q.get('pageSize') ?? 50);
    const page = Number(q.get('page') ?? 1);
    return { total: rows.length, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize) };
  }
  const lm = path.match(/^\/api\/listings\/(\d+)$/);
  if (lm) {
    const p = await profileFile(lm[1]);
    return { ...p, notes: [], evidence: d.publicEvidence.filter((e: any) => e.listing_id === Number(lm[1])), teardowns: [], watchlists: [], firstParty: [], links: { store: [], search: [], adLibraries: [] } };
  }
  const pm = path.match(/^\/api\/publishers\/(\d+)$/);
  if (pm) {
    const ls = d.listings.filter((l: any) => l.publisher_id === Number(pm[1]));
    if (!ls.length) throw new ApiError(404, 'Publisher not in the public dataset');
    return { publisher: { id: Number(pm[1]), name: ls[0].publisher_name, platform: ls[0].platform }, listings: ls };
  }
  if (path === '/api/coverage') return { scopes: d.coverage.scopes, providerStatus: d.coverage.providerStatus, obsCoverage: [], counts: d.coverage.counts };
  throw new ApiError(405, 'Not available in the public read-only build');
}

async function publicCompare(body: any) {
  const days = dayRange(body.from, body.to);
  const profiles = (await Promise.all(body.ids.map((id: number) => profileFile(id).catch(() => null)))).filter(Boolean);
  const scopes = new Map<string, any>();
  const rankRows: any[] = [];
  for (const p of profiles)
    for (const c of p.charts) {
      if (!scopes.has(c.scopeId)) scopes.set(c.scopeId, { scopeId: c.scopeId, scope: c.scope, categoryName: c.categoryName, members: [] });
      scopes.get(c.scopeId).members.push(p.listing.id);
      for (const pt of c.series)
        if (pt.day >= body.from && pt.day <= body.to)
          rankRows.push({ listing_id: p.listing.id, title: p.listing.title, scope_id: c.scopeId, day: pt.day, rank: pt.rank, presence: pt.presence, observed_depth: pt.depth, provenance: c.scope.provenance });
    }
  const obsRows = profiles.flatMap((p: any) => p.observations.filter((o: any) => o.snapshot_day >= body.from && o.snapshot_day <= body.to).map((o: any) => ({ listing_id: p.listing.id, title: p.listing.title, ...o, day: o.snapshot_day })));
  const notes: string[] = [];
  if (new Set(profiles.map((p: any) => p.listing.platform)).size > 1) notes.push('Listings span App Store and Google Play: metrics are shown side by side, never combined.');
  return { from: body.from, to: body.to, days, listings: profiles.map((p: any) => p.listing), scopes: [...scopes.values()], rankRows, obsRows, notes, evidence: [], teardowns: [] };
}

export const api = {
  async get<T = any>(url: string): Promise<T> {
    if (PUBLIC_MODE) {
      const u = new URL(url, 'http://x');
      return (await publicGet(u.pathname, u.searchParams, await dataset())) as T;
    }
    return http<T>('GET', url);
  },
  async post<T = any>(url: string, body: unknown = {}): Promise<T> {
    if (PUBLIC_MODE && url === '/api/compare') return (await publicCompare(body)) as T;
    return http<T>('POST', url, body);
  },
  patch: <T = any>(url: string, body: unknown) => http<T>('PATCH', url, body),
  del: <T = any>(url: string) => http<T>('DELETE', url),
  /** POST that returns a file download (CSV/JSON). */
  async download(url: string, body: unknown, filename: string) {
    let blob: Blob;
    if (PUBLIC_MODE) {
      const d = await this.post('/api/compare', body);
      const b = body as any;
      if (b.format === 'json') blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      else {
        const { toCsv } = await import('../../../shared/csv');
        blob = new Blob([toCsv(b.table === 'observations' ? d.obsRows : d.rankRows)], { type: 'text/csv' });
      }
    } else {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-radar-request': '1' }, body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({})))?.error ?? 'Export failed');
      blob = await res.blob();
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};

export function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) u.set(k, String(v));
  const s = u.toString();
  return s ? '?' + s : '';
}

export { addDays };

// ---------------- public-mode watchlists in browser storage ----------------
const LS_KEY = 'radar.public.watchlists';
export const localWatchlists = {
  where: 'This browser only (localStorage). Not synced, not sent anywhere.',
  load(): { name: string; ids: number[] }[] {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
    } catch {
      return [];
    }
  },
  save(v: { name: string; ids: number[] }[]) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
};
