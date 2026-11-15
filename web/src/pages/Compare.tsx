import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ListingPicker } from '../components/ListingPicker';
import { AppCell, DataTable, LineChart, ProvBadge, State, useAsync, useToast } from '../components/ui';
import { addDays, api } from '../lib/api';
import { fmtCompact, fmtNum, fmtPrice, scopeLabel, today } from '../lib/format';

export default function Compare() {
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const ids = (sp.get('ids') ?? '').split(',').map(Number).filter((n) => n > 0).slice(0, 5);
  const to = sp.get('to') ?? today();
  const from = sp.get('from') ?? addDays(to, -29);
  const market = sp.get('market') ?? '';
  const set = (k: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [a, b] of Object.entries(k)) {
      if (b) n.set(a, b);
      else n.delete(a);
    }
    setSp(n, { replace: true });
  };
  const body = { ids, from, to, market: market || undefined };
  const q = useAsync(() => (ids.length ? api.post('/api/compare', body) : Promise.resolve(null)), [ids.join(','), from, to, market]);
  const [scopeSel, setScopeSel] = useState<string[] | null>(null);
  const d: any = q.data;
  const scopes = d?.scopes ?? [];
  const selected = scopeSel ?? scopes.map((s: any) => s.scopeId);
  const exportAs = async (format: 'csv' | 'json', table: 'ranks' | 'observations') => {
    try {
      await api.download('/api/compare/export', { ...body, scopeIds: selected, format, table }, `compare-${table}-${to}.${format}`);
    } catch (e: any) {
      toast(e.message);
    }
  };
  const latestObs = useMemo(() => {
    if (!d) return [];
    const m = new Map<string, any>();
    for (const o of d.obsRows) m.set(`${o.listing_id}|${o.market}|${o.provider}|${o.provenance}`, o);
    return [...m.values()];
  }, [d]);
  return (
    <div>
      <h1>Compare</h1>
      <p className="sub">Up to five listings, one aligned date window. Ranks are compared only inside the same store/market/device/chart/category scope.</p>
      <div className="filters">
        <label className="f">
          Add listing ({ids.length}/5)
          {ids.length < 5 ? <ListingPicker exclude={ids} onPick={(l) => set({ ids: [...ids, l.id].join(',') })} /> : <span className="small">Maximum reached</span>}
        </label>
        <label className="f">
          From
          <input type="date" value={from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="f">
          To
          <input type="date" value={to} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <label className="f">
          Market
          <input type="text" value={market} placeholder="all" maxLength={2} onChange={(e) => set({ market: e.target.value.toLowerCase() })} style={{ width: 60 }} />
        </label>
        <div className="row">
          <button disabled={!d} onClick={() => exportAs('csv', 'ranks')}>Export ranks CSV</button>
          <button disabled={!d} onClick={() => exportAs('csv', 'observations')}>Export metadata CSV</button>
          <button disabled={!d} onClick={() => exportAs('json', 'ranks')}>Export JSON</button>
        </div>
      </div>
      {!ids.length ? (
        <State title="Pick listings to compare">Search the catalog above. Shareable: the selection lives in the URL.</State>
      ) : q.error ? (
        <State kind="error">{q.error.message}</State>
      ) : !d ? (
        <State kind="loading" />
      ) : (
        <>
          <div className="grid cols-3">
            {d.listings.map((l: any) => (
              <div className="card" key={l.id}>
                <AppCell l={l} />
                <div className="small muted" style={{ marginTop: 6 }}>
                  {l.category_name ?? '—'} · evidence {l.evidenceCount ?? 0} · teardowns {l.teardownCount ?? 0}
                </div>
                <button className="small" onClick={() => set({ ids: ids.filter((x) => x !== l.id).join(',') })}>Remove</button>
              </div>
            ))}
          </div>
          {d.notes.map((n: string) => (
            <div className="banner warn" key={n} style={{ marginTop: 10 }}>{n}</div>
          ))}
          <h2>Ranks by scope</h2>
          {scopes.length ? (
            <>
              <div className="chips">
                {scopes.map((s: any) => (
                  <button key={s.scopeId} className="chip" aria-pressed={selected.includes(s.scopeId)} onClick={() => setScopeSel(selected.includes(s.scopeId) ? selected.filter((x: string) => x !== s.scopeId) : [...selected, s.scopeId])}>
                    {scopeLabel(s.scope, s.categoryName)} ({s.members.length}/{d.listings.length})
                  </button>
                ))}
              </div>
              <div className="grid cols-2" style={{ marginTop: 10 }}>
                {scopes.filter((s: any) => selected.includes(s.scopeId)).map((s: any) => (
                  <div className="card" key={s.scopeId}>
                    <div className="row"><strong className="small">{scopeLabel(s.scope, s.categoryName)}</strong><ProvBadge p={s.scope.provenance} /></div>
                    {s.members.length < 2 && <div className="small muted">Only one compared listing appears in this scope — nothing to compare against here.</div>}
                    <LineChart
                      invert
                      days={d.days}
                      series={d.listings
                        .filter((l: any) => s.members.includes(l.id))
                        .map((l: any) => ({ name: l.title, points: d.rankRows.filter((r: any) => r.scope_id === s.scopeId && r.listing_id === l.id).map((r: any) => ({ day: r.day, value: r.rank, presence: r.presence })) }))}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <State title="No chart observations for these listings in the window" />
          )}
          <h2>Latest metadata (per listing × market × source)</h2>
          <p className="small muted">Side by side, never merged. Rating counts are not downloads; install thresholds are lifetime lower bounds; prices are list prices, not revenue.</p>
          {latestObs.length ? (
            <DataTable
              rows={latestObs}
              rowKey={(o: any) => `${o.listing_id}${o.market}${o.provider}${o.provenance}`}
              cols={[
                { key: 't', label: 'Listing', render: (o: any) => o.title, sort: (o: any) => o.title },
                { key: 'm', label: 'Market', render: (o: any) => o.market.toUpperCase(), sort: (o: any) => o.market },
                { key: 'd', label: 'Day', render: (o: any) => <>{o.day} <ProvBadge p={o.provenance} /></> },
                { key: 'p', label: 'Price', num: true, render: (o: any) => fmtPrice(o.price, o.currency) },
                { key: 'r', label: 'Rating', num: true, render: (o: any) => fmtNum(o.rating, 2), sort: (o: any) => o.rating },
                { key: 'rc', label: 'Ratings', num: true, render: (o: any) => fmtCompact(o.rating_count), sort: (o: any) => o.rating_count },
                { key: 'i', label: 'Installs ≥', render: (o: any) => o.install_band ?? '—' },
                { key: 'v', label: 'Version', render: (o: any) => o.version ?? '—' },
              ]}
            />
          ) : (
            <State title="No metadata in the window" />
          )}
          {(d.evidence.length > 0 || d.teardowns.length > 0) && (
            <>
              <h2>Evidence &amp; monetization notes</h2>
              <ul>
                {d.teardowns.map((t: any, i: number) => (
                  <li key={'t' + i}>
                    <strong>{d.listings.find((l: any) => l.id === t.listing_id)?.title}</strong> teardown {t.version_label} ({t.observed_at}): paywall {t.paywall_timing ?? '—'}; pricing {t.pricing ?? '—'}; trial {t.trial_terms ?? '—'}
                  </li>
                ))}
                {d.evidence.map((e: any, i: number) => (
                  <li key={'e' + i}>
                    <strong>{d.listings.find((l: any) => l.id === e.listing_id)?.title}</strong> [{e.kind}] {e.channel} — {e.hook} {e.url && <a href={e.url} target="_blank" rel="noreferrer noopener">↗</a>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
