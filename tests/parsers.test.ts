import { describe, expect, it } from 'vitest';
import { guardCell, parseCsv, toCsv } from '../shared/csv';
import { parseStoreRef } from '../shared/storeUrls';
import { legacyChartUrl, parseLegacyChart, parseLookup, parseV2Chart } from '../server/providers/apple';
import { installLowerBound, parsePlayDetails, playDetailsUrl } from '../server/providers/googlePlay';
import { MalformedPayloadError } from '../server/providers/types';
import { FIX, legacyFeed, lookupPayload } from './helpers';

const meta = { market: 'us', device: 'iphone' as const, chartType: 'free' as const, genre: 'all', depth: 3, url: 'https://itunes.apple.com/us/rss/x/json', fetchedAt: '2026-11-10T12:00:00.000Z' };

describe('store URL parsing (strict, allowlisted)', () => {
  it('parses Apple URLs and ids', () => {
    expect(parseStoreRef('https://apps.apple.com/in/app/whatsapp-messenger/id310633997')).toEqual({ platform: 'ios', storeId: '310633997', urlCountry: 'in' });
    expect(parseStoreRef('id310633997')).toEqual({ platform: 'ios', storeId: '310633997' });
    expect(parseStoreRef('310633997')?.platform).toBe('ios');
  });
  it('parses Android package URLs and bare packages (fallback registration path)', () => {
    expect(parseStoreRef('https://play.google.com/store/apps/details?id=com.whatsapp&hl=en&gl=IN')).toEqual({ platform: 'android', storeId: 'com.whatsapp', urlCountry: 'in' });
    expect(parseStoreRef('com.example.my_app')).toEqual({ platform: 'android', storeId: 'com.example.my_app' });
  });
  it('rejects arbitrary hosts, credentials, ports, and bad ids', () => {
    for (const bad of ['https://evil.com/id123456', 'https://apps.apple.com.evil.com/app/id123456', 'https://user:pw@apps.apple.com/us/app/id123456', 'https://play.google.com:8443/store/apps/details?id=com.x.y', 'https://play.google.com/store/search?q=x', 'https://play.google.com/store/apps/details?id=../../etc', 'javascript:alert(1)', 'file:///etc/passwd', 'com', '12'])
      expect(parseStoreRef(bad)).toBeNull();
  });
  it('builds request URLs only from validated parts', () => {
    expect(() => playDetailsUrl('com.x.y&gl=zz', 'us')).toThrow();
    expect(() => legacyChartUrl('usa', 'iphone', 'free', 'all', 10)).toThrow();
    expect(legacyChartUrl('in', 'ipad', 'grossing', '6014', 500)).toBe('https://itunes.apple.com/in/rss/topgrossingipadapplications/limit=200/genre=6014/json');
  });
});

describe('Apple payload parsing', () => {
  it('normalizes a legacy chart and uses the feed day as snapshot day', () => {
    const c = parseLegacyChart(legacyFeed([{ id: '111111', name: 'A' }, { id: '222222', name: 'B', price: '2.99' }]), meta);
    expect(c.entries.map((e) => [e.rank, e.storeId])).toEqual([[1, '111111'], [2, '222222']]);
    expect(c.entries[1].price).toBe(2.99);
    expect(c.snapshotDay).toBe('2026-11-10');
    expect(c.categoryScope).toBe('all');
  });
  it('handles a single-entry feed object and genre charts as real category charts', () => {
    const c = parseLegacyChart(FIX('apple-legacy-single.json'), { ...meta, genre: '6014' });
    expect(c.entries).toHaveLength(1);
    expect(c.categoryScope).toBe('category');
    expect(c.entries[0].publisherStoreId).toBe('987654321');
  });
  it('handles empty charts without inventing entries', () => {
    expect(parseLegacyChart(JSON.stringify({ feed: { updated: { label: '2026-11-10' } } }), meta).entries).toEqual([]);
  });
  it('rejects malformed payloads', () => {
    expect(() => parseLegacyChart('<html>oops</html>', meta)).toThrow(MalformedPayloadError);
    expect(() => parseLegacyChart(JSON.stringify({ nofeed: 1 }), meta)).toThrow(MalformedPayloadError);
    expect(() => parseLegacyChart(JSON.stringify({ feed: { entry: [{ 'im:name': { label: 'x' }, id: { attributes: { 'im:id': 'abc' } } }] } }), meta)).toThrow(MalformedPayloadError);
    expect(() => parseV2Chart(JSON.stringify({ feed: {} }), { market: 'us', chartType: 'free', depth: 10, url: 'u', fetchedAt: meta.fetchedAt })).toThrow(MalformedPayloadError);
  });
  it('marks ids missing from a lookup as unavailable in that storefront', () => {
    const rows = parseLookup(lookupPayload([{ trackId: 111111, trackName: 'A' }]), ['111111', '999999'], 'in', 'u');
    expect(rows[0].availability).toBe('available');
    expect(rows[1].availability).toBe('unavailable');
    expect(rows[1].market).toBe('in');
  });
});

describe('Google Play detail parsing', () => {
  it('reads structured data, install threshold as lower bound, and disclosures', () => {
    const n = parsePlayDetails(FIX('play-details.html'), 'com.fixture.planner', 'in', 'en', 'u');
    expect(n.title).toBe('Fixture Planner & Notes');
    expect(n.installBand).toBe('1M+');
    expect(n.installLowerBound).toBe(1_000_000);
    expect(n.currency).toBe('INR');
    expect(n.rating).toBe(4.39);
    expect(n.ratingCount).toBe(123456);
    expect(n.hasAds).toBe(true);
    expect(n.hasIap).toBe(true);
    expect(n.storeUpdatedAt?.slice(0, 10)).toBe('2026-11-03');
    expect(n.categoryId).toBe('PRODUCTIVITY');
  });
  it('rejects pages without structured data (layout change, consent wall)', () => {
    expect(() => parsePlayDetails('<html><body>Before you continue</body></html>', 'com.x.y', 'us', 'en', 'u')).toThrow(MalformedPayloadError);
  });
  it('parses thresholds strictly', () => {
    expect(installLowerBound('10B+')).toBe(1e10);
    expect(installLowerBound('5,000+')).toBe(5000);
    expect(installLowerBound('about 5000')).toBeNull();
    expect(installLowerBound(null)).toBeNull();
  });
});

describe('CSV safety', () => {
  it('guards spreadsheet formulas but leaves numbers alone', () => {
    expect(guardCell('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
    expect(guardCell('+1')).toBe("'+1");
    expect(guardCell('@SUM')).toBe("'@SUM");
    expect(guardCell(-5)).toBe('-5');
    expect(guardCell(null)).toBe('');
    const csv = toCsv([{ a: '=cmd|x', b: 'x,"y"', c: null }]);
    expect(csv).toContain("'=cmd|x");
    expect(csv).toContain('"x,""y"""');
    expect(csv.split('\r\n')[1].endsWith(',')).toBe(true); // blank stays blank
  });
  it('parses quoted fields, CRLF and BOM', () => {
    const r = parseCsv('﻿a,b\r\n"1,2","he said ""hi"""\r\n3,\n');
    expect(r.header).toEqual(['a', 'b']);
    expect(r.rows).toEqual([{ a: '1,2', b: 'he said "hi"' }, { a: '3', b: '' }]);
    expect(() => parseCsv('a\n"open')).toThrow();
  });
});
