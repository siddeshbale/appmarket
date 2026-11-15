import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config';
import { migrate, openDb } from '../server/db';
import type { Transport } from '../server/http/client';

export const FIX = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

export function memDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

export function testConfig(over: Partial<ReturnType<typeof loadConfig>> = {}) {
  return {
    ...loadConfig(),
    mode: 'live' as const,
    dbPath: ':memory:',
    ingestMarkets: ['us', 'in'],
    chartDepth: 3,
    appleCharts: [{ device: 'iphone' as const, chartType: 'free' as const, genre: 'all' }],
    minIntervalMs: { apple: 0, google: 0 },
    cacheTtlMin: 0,
    googlePlayEnabled: true,
    ...over,
  };
}

/** Build a legacy iTunes RSS payload (structure matches the live feed; all values fictional). */
export function legacyFeed(entries: { id: string; name: string; artist?: string; cat?: [string, string]; price?: string; currency?: string }[], updated = '2026-11-10T03:00:00-07:00') {
  return JSON.stringify({
    feed: {
      updated: { label: updated },
      entry: entries.map((e) => ({
        'im:name': { label: e.name },
        'im:image': [{ label: `https://is1-ssl.mzstatic.com/image/thumb/${e.id}/100x100bb.png`, attributes: { height: '100' } }],
        'im:price': { label: 'Get', attributes: { amount: e.price ?? '0.00000', currency: e.currency ?? 'USD' } },
        id: { label: `https://apps.apple.com/us/app/x/id${e.id}?uo=2`, attributes: { 'im:id': e.id, 'im:bundleId': `com.fixture.${e.name.toLowerCase().replace(/\W/g, '')}` } },
        'im:artist': { label: e.artist ?? 'Fixture Dev', attributes: { href: 'https://apps.apple.com/us/developer/fixture/id100000001?uo=2' } },
        category: { attributes: { 'im:id': e.cat?.[0] ?? '6007', term: 'Productivity', scheme: 'x', label: e.cat?.[1] ?? 'Productivity' } },
        'im:releaseDate': { label: '2024-01-15T00:00:00-07:00' },
        link: [{ attributes: { rel: 'alternate', type: 'text/html', href: `https://apps.apple.com/us/app/x/id${e.id}?uo=2` } }],
      })),
    },
  });
}

export function lookupPayload(results: { trackId: number; trackName: string; price?: number; currency?: string; version?: string; userRatingCount?: number }[]) {
  return JSON.stringify({
    resultCount: results.length,
    results: results.map((r) => ({
      kind: 'software', wrapperType: 'software', trackId: r.trackId, trackName: r.trackName, artistName: 'Fixture Dev', artistId: 100000001,
      artistViewUrl: 'https://apps.apple.com/us/developer/fixture/id100000001?uo=4', primaryGenreId: 6007, primaryGenreName: 'Productivity', genreIds: ['6007'],
      price: r.price ?? 0, currency: r.currency ?? 'USD', averageUserRating: 4.5, userRatingCount: r.userRatingCount ?? 1000, version: r.version ?? '1.0',
      currentVersionReleaseDate: '2026-11-01T10:00:00Z', releaseDate: '2024-01-15T08:00:00Z', description: 'A fixture app for habit tracking and daily planner notes.',
      bundleId: `com.fixture.${r.trackName.toLowerCase().replace(/\W/g, '')}`,
    })),
  });
}

type Route = (url: string) => { status: number; body: string; headers?: Record<string, string> } | Promise<{ status: number; body: string; headers?: Record<string, string> }>;
/** Fixture transport: routes by URL; records calls. */
export function fixtureTransport(route: Route): Transport & { calls: string[] } {
  const calls: string[] = [];
  const t = (async (url: string) => {
    calls.push(url);
    const r = await route(url);
    const h = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { status: r.status, headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null }, text: async () => r.body };
  }) as unknown as Transport & { calls: string[] };
  t.calls = calls;
  return t;
}
export const noSleep = async () => {};
