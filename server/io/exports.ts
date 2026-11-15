// Comparison export, research brief, and the sanitized public dataset.
import { addDays, dayRange } from '../../shared/ranks';
import { metricLabelFor } from '../../shared/types';
import { adLibraryLinks, storeListingUrl } from '../../shared/storeUrls';
import { all, get, type Db } from '../db';
import { chartView, listingProfile, listScopes, moversView, newToChartView, parseScopeId, coverage } from '../repo/query';
import { PROVIDERS } from '../providers/manifest';

export interface CompareRequest {
  ids: number[];
  from: string;
  to: string;
  scopeIds?: string[]; // explicit chart scopes
  market?: string;
}

export function compareData(db: Db, req: CompareRequest) {
  const ids = req.ids.slice(0, 5);
  const days = dayRange(req.from, req.to);
  const profiles = ids.map((id) => listingProfile(db, id, { from: req.from, to: req.to, includePrivate: true })).filter(Boolean) as any[];
  const scopes = new Map<string, { scopeId: string; scope: any; categoryName: string; members: number[] }>();
  for (const p of profiles)
    for (const c of p.charts) {
      if (req.scopeIds?.length && !req.scopeIds.includes(c.scopeId)) continue;
      if (req.market && c.scope.market !== req.market) continue;
      if (!scopes.has(c.scopeId)) scopes.set(c.scopeId, { scopeId: c.scopeId, scope: c.scope, categoryName: c.categoryName, members: [] });
      scopes.get(c.scopeId)!.members.push(p.listing.id);
    }
  const rankRows: any[] = [];
  for (const p of profiles)
    for (const c of p.charts) {
      if (!scopes.has(c.scopeId)) continue;
      for (const pt of c.series)
        rankRows.push({
          listing_id: p.listing.id, platform: p.listing.platform, store_id: p.listing.store_id, title: p.listing.title, scope_id: c.scopeId, market: c.scope.market,
          device: c.scope.device, chart_type: c.scope.chartType, category: c.scope.category, category_scope: c.scope.categoryScope, provider: c.scope.provider,
          provenance: c.scope.provenance, label: metricLabelFor(c.scope.provenance), day: pt.day, rank: pt.rank, presence: pt.presence, observed_depth: pt.depth,
        });
    }
  const obsRows: any[] = [];
  for (const p of profiles)
    for (const o of p.observations) {
      if (o.snapshot_day < req.from || o.snapshot_day > req.to) continue;
      if (req.market && o.market !== req.market) continue;
      obsRows.push({
        listing_id: p.listing.id, platform: p.listing.platform, store_id: p.listing.store_id, title: p.listing.title, market: o.market, day: o.snapshot_day, observed_at: o.observed_at,
        provider: o.provider, provenance: o.provenance, label: metricLabelFor(o.provenance), availability: o.availability, price: o.price, currency: o.currency, rating: o.rating,
        rating_count: o.rating_count, rating_scope: o.rating_scope, install_band: o.install_band, install_lower_bound: o.install_lower_bound, version: o.version,
        store_updated_at: o.store_updated_at, has_ads: o.has_ads, has_iap: o.has_iap, source_url: o.source_url,
      });
    }
  // Comparability: rank metrics are comparable only within the same scope; rating counts only within the same platform+market.
  const notes: string[] = [];
  const platforms = new Set(profiles.map((p) => p.listing.platform));
  if (platforms.size > 1) notes.push('Listings span App Store and Google Play: ranks, ratings and install figures are NOT comparable across stores and are shown side by side, never combined.');
  for (const s of scopes.values()) if (s.members.length < profiles.length) notes.push(`Scope ${s.scopeId}: only ${s.members.length}/${profiles.length} listings were observed in it.`);
  return {
    from: req.from, to: req.to, days, generatedAt: new Date().toISOString(),
    listings: profiles.map((p) => ({ ...p.listing, evidenceCount: p.evidence.length, teardownCount: p.teardowns.length, notes: p.notes.map((n: any) => n.body) })),
    scopes: [...scopes.values()], rankRows, obsRows, notes,
    evidence: profiles.flatMap((p) => p.evidence.map((e: any) => ({ listing_id: p.listing.id, kind: e.kind, channel: e.channel, hook: e.hook, url: e.url, first_observed: e.first_observed }))),
    teardowns: profiles.flatMap((p) => p.teardowns.map((t: any) => ({ listing_id: p.listing.id, version_label: t.version_label, observed_at: t.observed_at, paywall_timing: t.paywall_timing, pricing: t.pricing, trial_terms: t.trial_terms }))),
  };
}

// ---------------- Research brief ----------------
export interface BriefRequest {
  ids: number[];
  from?: string;
  to?: string;
  includeEvidence?: boolean;
  includeNotes?: boolean;
  title?: string;
}

const md = (s: unknown) => String(s ?? '').replace(/([\\`*_[\]<>|])/g, '\\$1').replace(/\r?\n/g, ' ');

export function researchBrief(db: Db, req: BriefRequest): { markdown: string; prompt: string } {
  const to = req.to ?? new Date().toISOString().slice(0, 10);
  const from = req.from ?? addDays(to, -29);
  const ids = req.ids.slice(0, 50);
  const lines: string[] = [];
  lines.push(`# ${md(req.title || 'Research brief')}`, '');
  lines.push(`Window: ${from} → ${to} (UTC provider days). Generated ${new Date().toISOString()} by App Market Radar (deterministic; no AI involved).`, '');
  lines.push('Labels: **Observed** = fetched from a public store source; **User-supplied** = imported or entered manually; **Modeled** = scenario output. Ranks are positions in a specific chart scope, not downloads or revenue.', '');
  for (const id of ids) {
    const p = listingProfile(db, id, { from, to, includePrivate: true });
    if (!p) continue;
    const l = p.listing;
    lines.push(`## ${md(l.title)} (${l.platform === 'ios' ? 'App Store' : 'Google Play'} · ${md(l.store_id)})`, '');
    lines.push(`- Publisher: ${md(l.publisher_name ?? 'unknown')}`);
    lines.push(`- Store category: ${md(l.category_name ?? 'unknown')}${l.unified_name ? ` (mapped to ${md(l.unified_name)})` : ''}`);
    if (l.release_date) lines.push(`- Release date (store-reported): ${l.release_date}`);
    const byMarket = new Map<string, any>();
    for (const o of p.observations) if (o.availability === 'available') byMarket.set(`${o.market}|${o.provenance}`, o);
    for (const o of byMarket.values()) {
      const bits = [
        o.price != null ? `price ${o.price} ${o.currency ?? ''}` : null,
        o.rating != null ? `rating ${Number(o.rating).toFixed(2)}${o.rating_count != null ? ` from ${o.rating_count.toLocaleString('en-US')} ratings (${o.rating_scope ?? 'scope unknown'})` : ''}` : null,
        o.install_band ? `install threshold ${o.install_band} (lifetime lower bound)` : null,
        o.version ? `v${md(o.version)}` : null,
        o.store_updated_at ? `updated ${String(o.store_updated_at).slice(0, 10)}` : null,
        o.has_ads === 1 ? 'discloses ads' : null,
        o.has_iap === 1 ? 'discloses in-app purchases' : null,
      ].filter(Boolean);
      lines.push(`- ${o.market.toUpperCase()} [${metricLabelFor(o.provenance)}, ${o.provider}, ${o.snapshot_day}]: ${bits.join('; ') || 'no fields'} — source: ${o.source_url ?? 'n/a'}`);
    }
    if (p.charts.length) {
      lines.push('', '| Chart scope | Label | Latest | Best in window | Days ranked / days fetched |', '|---|---|---|---|---|');
      for (const c of p.charts) {
        const fetched = c.series.filter((x: any) => x.presence === 'ranked' || x.presence === 'absent').length;
        const ranked = c.series.filter((x: any) => x.presence === 'ranked').length;
        const latest = c.latest ? (c.latest.rank ? `#${c.latest.rank} (${c.latest.day})` : `${c.latest.presence} (${c.latest.day})`) : 'no data';
        lines.push(`| ${md(c.scope.market.toUpperCase())} ${md(c.scope.device)} top ${md(c.scope.chartType)} · ${md(c.categoryName)} · ${md(c.scope.provider)} | ${metricLabelFor(c.scope.provenance)} | ${latest} | ${c.best ? '#' + c.best : '—'} | ${ranked} / ${fetched} |`);
      }
    } else lines.push('- No chart observations in the window.');
    const verified = p.crossStore.filter((x: any) => x.status === 'verified');
    if (verified.length) lines.push(`- Verified cross-store listing(s): ${verified.map((v: any) => `${md(v.listing?.title)} (${v.listing?.platform} ${md(v.listing?.store_id)})`).join(', ')}`);
    if (req.includeEvidence !== false && (p.evidence.length || p.teardowns.length)) {
      lines.push('', '**Evidence (references)**');
      for (const e of p.evidence.slice(0, 20)) lines.push(`- [${e.kind}] ${md(e.channel ?? '')} ${md(e.hook ?? '')} ${e.first_observed ? `first seen ${e.first_observed}` : ''} ${e.url ? `— ${e.url}` : ''}`.trim());
      for (const t of p.teardowns.slice(0, 5))
        lines.push(`- [onboarding ${md(t.version_label ?? '')} ${t.observed_at}] first action: ${md(t.first_meaningful_action ?? '—')}; paywall: ${md(t.paywall_timing ?? '—')}; trial: ${md(t.trial_terms ?? '—')}; pricing: ${md(t.pricing ?? '—')}`);
    }
    if (req.includeNotes && p.notes.length) {
      lines.push('', '**Private notes**');
      for (const n of p.notes) lines.push(`- ${md(n.body)}`);
    }
    lines.push('', `Store page: ${storeListingUrl(l.platform, l.store_id, 'us')}  ·  Ad library searches: ${adLibraryLinks(l.publisher_name ?? l.title, 'us').map((a) => a.url).join(' , ')}`, '');
  }
  lines.push('## Known gaps', '', '- No download, revenue, retention or search-volume measurements are included — none are available from the sources used.', '- Chart history only covers days on which a comparable chart was fetched; gaps are shown as gaps.', '- Google Play chart ranks exist only where they were imported or entered manually.', '');
  const markdown = lines.join('\n');
  const prompt = [
    'You are a mobile market analyst. Below is a source-linked research brief exported from a local tool.',
    'Rules: treat every number as scoped to its stated store, market, chart and date; do not convert ranks or rating counts into downloads or revenue; flag where data is missing.',
    'Please return:',
    '1. Observations — what the data directly shows (cite the line).',
    '2. Hypotheses — plausible explanations, each labeled as a hypothesis with the evidence that would confirm or refute it.',
    '3. Missing data — what you would need to be more confident, and where it could legitimately be obtained.',
    '4. Testable opportunities — concrete, low-cost experiments (store listing, onboarding, pricing, creative) with a success metric.',
    '',
    '--- BRIEF START ---',
    markdown,
    '--- BRIEF END ---',
  ].join('\n');
  return { markdown, prompt };
}

// ---------------- Public dataset (sanitized) ----------------
/**
 * Builds the read-only public dataset. EXCLUDES: private notes, evidence (unless explicitly marked public),
 * teardowns, first-party metrics, keyword data, imports metadata, descriptions, raw payloads/cache, run logs,
 * and anything with provenance 'imported' from private import kinds. Includes only fields listed as
 * redistributable in the provider manifest.
 */
export function buildPublicDataset(db: Db, opts: { maxListings?: number; historyDays?: number } = {}) {
  const to = new Date().toISOString().slice(0, 10);
  const from = addDays(to, -(opts.historyDays ?? 90));
  const scopes = listScopes(db).filter((s) => s.provenance === 'observed' || s.provenance === 'demo');
  const charts: Record<string, any> = {};
  const listingIds = new Set<number>();
  for (const s of scopes) {
    const sc = parseScopeId(s.id)!;
    const cv = chartView(db, sc);
    const mv7 = moversView(db, sc, 7);
    const mv30 = moversView(db, sc, 30);
    const nt = newToChartView(db, sc);
    const slim = (r: any) => ({ id: r.id, rank: r.rank ?? null, move1: r.move1 ?? null, move7: r.move7 ?? null, movement: r.movement ?? null, previousRank: r.previousRank ?? null, explanation: r.explanation ?? null });
    cv.rows.forEach((r: any) => listingIds.add(r.id));
    charts[s.id] = {
      scope: { ...s },
      day: cv.day, snapshot: cv.snapshot ? { ...cv.snapshot, sourceUrl: cv.snapshot.sourceUrl?.startsWith('import:') ? null : cv.snapshot.sourceUrl } : null,
      rows: cv.rows.map(slim),
      movers7: { comparedDay: mv7.comparedDay, insufficient: mv7.insufficient, rows: mv7.rows.map(slim), dropped: (mv7 as any).dropped?.map(slim) ?? [] },
      movers30: { comparedDay: mv30.comparedDay, insufficient: mv30.insufficient, rows: mv30.rows.map(slim), dropped: (mv30 as any).dropped?.map(slim) ?? [] },
      newToChart: { comparedDay: nt.comparedDay, rows: nt.rows.map(slim) },
    };
  }
  const tracked = all<{ id: number }>(db, "SELECT id FROM listings WHERE tracked = 1 AND provenance IN ('observed','demo')");
  tracked.forEach((t) => listingIds.add(t.id));
  const ids = [...listingIds].slice(0, opts.maxListings ?? 3000);
  const listings: any[] = [];
  const profiles: Record<number, any> = {};
  for (const id of ids) {
    const p = listingProfile(db, id, { from, to, includePrivate: false });
    if (!p) continue;
    const l = p.listing;
    if (l.provenance === 'imported') continue; // user-registered listings are included only with their observed data
    const pubObs = p.observations.filter((o: any) => o.provenance === 'observed' || o.provenance === 'demo');
    const latest = pubObs[pubObs.length - 1];
    const listing = {
      id: l.id, platform: l.platform, store_id: l.store_id, title: l.title, icon_url: l.icon_url, is_game: l.is_game, release_date: l.release_date, provenance: l.provenance,
      publisher_id: l.publisher_id, publisher_name: l.publisher_name, category_id: l.category_id, category_name: l.category_name, unified_slug: l.unified_slug, unified_name: l.unified_name,
      price: latest?.price ?? null, currency: latest?.currency ?? null, rating: latest?.rating ?? null, rating_count: latest?.rating_count ?? null, install_band: latest?.install_band ?? null,
      markets: [...new Set([...pubObs.map((o: any) => o.market), ...p.charts.map((c: any) => c.scope.market)])],
    };
    listings.push(listing);
    profiles[id] = {
      listing: { ...listing, first_seen_at: l.first_seen_at, last_seen_at: l.last_seen_at },
      observations: pubObs.map((o: any) => ({
        market: o.market, provider: o.provider, provenance: o.provenance, snapshot_day: o.snapshot_day, availability: o.availability, source_url: o.source_url, title: o.title, version: o.version,
        store_updated_at: o.store_updated_at, release_date: o.release_date, price: o.price, currency: o.currency, rating: o.rating, rating_count: o.rating_count, rating_scope: o.rating_scope,
        install_band: o.install_band, install_lower_bound: o.install_lower_bound, has_ads: o.has_ads, has_iap: o.has_iap, content_rating: o.content_rating,
      })),
      charts: p.charts.filter((c: any) => c.scope.provenance === 'observed' || c.scope.provenance === 'demo'),
      related: p.related.map((r: any) => ({ id: r.id, platform: r.platform, title: r.title, store_id: r.store_id })),
      crossStore: p.crossStore.filter((c: any) => c.status === 'verified').map((c: any) => ({ status: c.status, listing: c.listing && { id: c.listing.id, platform: c.listing.platform, title: c.listing.title, store_id: c.listing.store_id } })),
    };
  }
  const publicEvidence = all<any>(db, 'SELECT kind, listing_id, channel, market, advertiser, hook, format, url, first_observed FROM evidence WHERE is_public = 1');
  const cov = coverage(db);
  return {
    generatedAt: new Date().toISOString(),
    mode: get<any>(db, "SELECT COUNT(*) AS n FROM listings WHERE provenance = 'demo'")?.n > 0 ? 'demo' : 'live',
    window: { from, to },
    scopes: scopes.map((s) => ({ ...s })),
    charts,
    listings,
    profiles,
    publicEvidence,
    coverage: { scopes: cov.scopes, providerStatus: cov.providerStatus.map((p: any) => ({ provider: p.provider, last_success: p.last_success, last_status: p.last_status, stale: p.stale })), counts: { listings: listings.length, scopes: scopes.length } },
    providers: PROVIDERS.map((p) => ({ id: p.id, name: p.name, status: p.status, docsUrl: p.docsUrl, limitations: p.limitations, publicExportFields: p.publicExportFields })),
    unified: all<any>(db, 'SELECT slug, name, is_game FROM unified_categories ORDER BY is_game, name'),
    markets: all<any>(db, 'SELECT code, name, enabled FROM markets ORDER BY code'),
  };
}
