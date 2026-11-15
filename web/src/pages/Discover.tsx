import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppCell, DataTable, Movement, ProvBadge, ScopeSelect, State, useAsync, type Col } from '../components/ui';
import { api, PUBLIC_MODE, qs } from '../lib/api';
import { fmtCompact, fmtDay, fmtNum, fmtPrice, scopeLabel } from '../lib/format';
import { useMeta } from '../lib/meta';

const TABS = [
  ['charts', 'Top Charts'],
  ['trending', 'Trending (movers)'],
  ['new', 'New to Chart'],
  ['catalog', 'Catalog search'],
] as const;

export default function Discover() {
  const [sp, setSp] = useSearchParams();
  const meta = useMeta();
  const tab = sp.get('tab') ?? 'charts';
  const set = (k: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [a, b] of Object.entries(k)) {
      if (b === null || b === '') n.delete(a);
      else n.set(a, b);
    }
    setSp(n, { replace: true });
  };
  const scopes = useAsync(() => api.get<any[]>('/api/scopes'), []);
  const scopeId = sp.get('scope') ?? '';
  useEffect(() => {
    if (!scopeId && scopes.data?.length) {
      const pick =
        scopes.data.find((s) => s.market === 'us' && s.device === 'iphone' && s.chartType === 'free' && s.category === 'all' && s.lastOkDay) ??
        scopes.data.find((s) => s.lastOkDay) ??
        scopes.data[0];
      set({ scope: pick.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopes.data, scopeId]);
  const scope = scopes.data?.find((s) => s.id === scopeId);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Discover</h1>
          <div className="sub">Charts, movers and the tracked catalog. Every list is scoped to one store, market, device, chart and category.</div>
        </div>
        {!PUBLIC_MODE && (
          <Link className="btn" to="/track">
            + Track an app by URL or ID
          </Link>
        )}
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => set({ tab: k, page: null })}>
            {label}
          </button>
        ))}
      </div>
      {tab !== 'catalog' && (
        <>
          {scopes.loading && !scopes.data ? (
            <State kind="loading" />
          ) : !scopes.data?.length ? (
            <State title="No chart data yet">
              {meta?.mode === 'demo' ? 'Run npm run seed:demo.' : PUBLIC_MODE ? 'This snapshot has no charts.' : (
                <>
                  Collect today's charts from <Link to="/data?tab=runs">Data &amp; settings → Run ingestion</Link> or run <code>npm run ingest</code>. You can also{' '}
                  <Link to="/track">track individual apps</Link> or <Link to="/data?tab=import">import chart snapshots</Link>.
                </>
              )}
            </State>
          ) : (
            <>
              <ChartFilters scopes={scopes.data} scopeId={scopeId} sp={sp} set={set} tab={tab} unified={meta?.unified ?? []} />
              {scope && <ScopeStatus scope={scope} />}
              {scopeId && tab === 'charts' && <TopChart scopeId={scopeId} sp={sp} />}
              {scopeId && tab === 'trending' && <Trending scopeId={scopeId} windowDays={sp.get('window') === '30' ? 30 : 7} />}
              {scopeId && tab === 'new' && <NewToChart scopeId={scopeId} />}
            </>
          )}
        </>
      )}
      {tab === 'catalog' && <Catalog sp={sp} set={set} meta={meta} />}
    </div>
  );
}

function ChartFilters({ scopes, scopeId, sp, set, tab, unified }: any) {
  const markets = [...new Set(scopes.map((s: any) => s.market))] as string[];
  const curMarket = scopes.find((s: any) => s.id === scopeId)?.market;
  const visible = scopes.filter((s: any) => !sp.get('m') || s.market === sp.get('m'));
  return (
    <div className="filters">
      <label className="f">
        Market
        <select value={sp.get('m') ?? ''} onChange={(e) => {
          const m = e.target.value;
          const first = scopes.find((s: any) => s.market === m && s.lastOkDay) ?? scopes.find((s: any) => s.market === m);
          set({ m: m || null, scope: first?.id ?? scopeId });
        }}>
          <option value="">All markets ({markets.join(', ').toUpperCase()})</option>
          {markets.map((m) => (
            <option key={m} value={m}>
              {m.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      <ScopeSelect scopes={visible.length ? visible : scopes} value={scopeId} onChange={(v) => set({ scope: v })} />
      {tab === 'charts' && (
        <>
          <label className="f" title="Filtering a chart locally produces a FILTERED SUBSET of that chart — not a category chart.">
            Filter subset by category
            <select value={sp.get('unified') ?? ''} onChange={(e) => set({ unified: e.target.value })}>
              <option value="">All (no filter)</option>
              {unified.map((u: any) => (
                <option key={u.slug} value={u.slug}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="f">
            Price
            <select value={sp.get('priceType') ?? ''} onChange={(e) => set({ priceType: e.target.value })}>
              <option value="">Any</option>
              <option value="free">Free</option>
              <option value="paid">Paid</option>
            </select>
          </label>
          <label className="f">
            Released after
            <input type="date" value={sp.get('releasedAfter') ?? ''} onChange={(e) => set({ releasedAfter: e.target.value })} />
          </label>
        </>
      )}
      {tab === 'trending' && (
        <label className="f">
          Window
          <select value={sp.get('window') ?? '7'} onChange={(e) => set({ window: e.target.value })}>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </label>
      )}
      <span className="small muted">Market: {curMarket?.toUpperCase()} · share this view by copying the URL</span>
    </div>
  );
}

function ScopeStatus({ scope }: { scope: any }) {
  const stale = scope.lastOkDay && Date.now() - Date.parse(scope.lastOkDay) > 2 * 86400000;
  return (
    <div className={`banner ${scope.lastStatus === 'failed' ? 'bad' : stale ? 'warn' : ''}`} style={{ background: scope.lastStatus === 'failed' || stale ? undefined : 'var(--panel)' }}>
      <div className="row">
        <strong>{scopeLabel(scope)}</strong>
        <ProvBadge p={scope.provenance} />
        {scope.categoryScope === 'category' && <span className="badge">Real category chart from source</span>}
        <span className="spacer" />
        <span className="small muted">
          Source <code>{scope.provider}</code> · {scope.okDays} day(s) fetched ({scope.firstDay} → {scope.lastDay}) · last depth {scope.lastDepth}
          {scope.lastRequestedDepth ? `/${scope.lastRequestedDepth}` : ''}
        </span>
      </div>
      {scope.lastStatus === 'failed' && (
        <div className="small">
          Latest fetch on {scope.lastDay} failed ({scope.lastError}). Showing the last successful snapshot ({scope.lastOkDay ?? 'none'}); earlier data is kept.
        </div>
      )}
      {stale && scope.lastStatus !== 'failed' && <div className="small">Stale: the newest successful snapshot is {scope.lastOkDay}.</div>}
    </div>
  );
}

function TopChart({ scopeId, sp }: { scopeId: string; sp: URLSearchParams }) {
  const q = useAsync(
    () => api.get(`/api/charts${qs({ scope: scopeId, unified: sp.get('unified'), priceType: sp.get('priceType'), releasedAfter: sp.get('releasedAfter') })}`),
    [scopeId, sp.get('unified'), sp.get('priceType'), sp.get('releasedAfter')],
  );
  const cols: Col<any>[] = useMemo(
    () => [
      { key: 'rank', label: 'Rank', num: true, render: (r) => <strong>#{r.rank}</strong>, sort: (r) => r.rank },
      { key: 'app', label: 'App', render: (r) => <AppCell l={r} />, sort: (r) => r.title },
      { key: 'cat', label: 'Store category', render: (r) => r.category_name ?? '—', sort: (r) => r.category_name },
      { key: 'm1', label: '1d', title: 'Change vs the previous day in the same scope', render: (r) => <Movement m={r.move1} />, sort: (r) => r.move1?.delta ?? null },
      { key: 'm7', label: '7d', title: 'Change vs 7 days earlier (±2 days tolerance) in the same scope', render: (r) => <Movement m={r.move7} />, sort: (r) => r.move7?.delta ?? null },
      { key: 'price', label: 'Price (chart)', num: true, render: (r) => fmtPrice(r.price, r.currency), sort: (r) => r.price },
      { key: 'rel', label: 'Released', render: (r) => fmtDay(r.release_date), sort: (r) => r.release_date },
    ],
    [],
  );
  if (q.error) return <State kind="error">{q.error.message}</State>;
  if (!q.data) return <State kind="loading" />;
  const d: any = q.data;
  if (!d.day) return <State title="No successful snapshot in this scope">Every fetch for this scope failed or returned nothing. Prior verified data, if any, would be shown here.</State>;
  return (
    <div>
      {d.filteredSubset && (
        <div className="banner warn">
          <strong>Filtered subset</strong> of the chart above (filters applied locally). Ranks are positions in the unfiltered chart — this is not a category chart.
        </div>
      )}
      <p className="small muted">
        Snapshot {d.day} · {d.snapshot.status} · {d.snapshot.observedDepth} entries observed{d.snapshot.requestedDepth ? ` of ${d.snapshot.requestedDepth} requested` : ''} · fetched {d.snapshot.fetchedAt?.slice(0, 16).replace('T', ' ')} UTC ·{' '}
        {d.snapshot.sourceUrl?.startsWith('https://') ? (
          <a href={d.snapshot.sourceUrl} target="_blank" rel="noreferrer noopener">
            source
          </a>
        ) : (
          <span>{d.snapshot.sourceUrl}</span>
        )}
        . Top grossing is a rank, not revenue.
      </p>
      {d.rows.length ? <DataTable rows={d.rows} cols={cols} rowKey={(r) => r.id} caption="Top chart" /> : <State title="No entries match the filter" />}
    </div>
  );
}

function Trending({ scopeId, windowDays }: { scopeId: string; windowDays: 7 | 30 }) {
  const q = useAsync(() => api.get(`/api/movers${qs({ scope: scopeId, window: windowDays })}`), [scopeId, windowDays]);
  if (q.error) return <State kind="error">{q.error.message}</State>;
  if (!q.data) return <State kind="loading" />;
  const d: any = q.data;
  if (d.insufficient)
    return (
      <State title={`Insufficient history for a ${windowDays}-day comparison`}>
        Movement needs a comparable snapshot {windowDays}–{windowDays + 2} days before {d.day ?? 'the latest day'} in this exact scope. No delta is shown rather than an invented one. History builds up with daily collection.
      </State>
    );
  const rows = d.rows.filter((r: any) => r.movement.kind !== 'insufficient');
  const up = rows.filter((r: any) => r.movement.kind === 'up').sort((a: any, b: any) => b.movement.delta - a.movement.delta);
  const down = rows.filter((r: any) => r.movement.kind === 'down').sort((a: any, b: any) => a.movement.delta - b.movement.delta);
  const entered = rows.filter((r: any) => r.movement.kind === 'new_first_observed' || r.movement.kind === 'reentry');
  const cols: Col<any>[] = [
    { key: 'now', label: 'Now', num: true, render: (r) => '#' + r.movement.currentRank, sort: (r) => r.movement.currentRank },
    { key: 'then', label: d.comparedDay, num: true, render: (r) => (r.movement.previousRank ? '#' + r.movement.previousRank : '—'), sort: (r) => r.movement.previousRank },
    { key: 'mv', label: 'Change', render: (r) => <Movement m={r.movement} />, sort: (r) => r.movement.delta },
    { key: 'app', label: 'App', render: (r) => <AppCell l={r} /> },
    { key: 'why', label: 'Explanation', render: (r) => <span className="small">{r.movement.explanation}</span> },
  ];
  return (
    <div>
      <p className="small muted">
        Rank on {d.day} vs {d.comparedDay} in the same scope. “Up” means closer to #1. Entries outside the observed chart depth on either day are listed separately, not given a delta.
      </p>
      <div className="grid cols-2">
        <div>
          <h2>Biggest risers ({up.length})</h2>
          {up.length ? <DataTable rows={up.slice(0, 50)} cols={cols} rowKey={(r) => r.id} /> : <State title="No risers" />}
        </div>
        <div>
          <h2>Biggest fallers ({down.length})</h2>
          {down.length ? <DataTable rows={down.slice(0, 50)} cols={cols} rowKey={(r) => r.id} /> : <State title="No fallers" />}
        </div>
      </div>
      <h2>Entered the observed chart ({entered.length})</h2>
      {entered.length ? <DataTable rows={entered} cols={cols} rowKey={(r) => r.id} /> : <State title="None" />}
      <h2>Dropped out of the observed depth ({d.dropped?.length ?? 0})</h2>
      {d.dropped?.length ? (
        <DataTable rows={d.dropped} cols={[{ key: 'p', label: `Rank on ${d.comparedDay}`, num: true, render: (r: any) => '#' + r.previousRank }, { key: 'a', label: 'App', render: (r: any) => <AppCell l={r} /> }, { key: 'e', label: 'Explanation', render: (r: any) => <span className="small">{r.explanation}</span> }]} rowKey={(r: any) => r.id} />
      ) : (
        <State title="None" />
      )}
    </div>
  );
}

function NewToChart({ scopeId }: { scopeId: string }) {
  const q = useAsync(() => api.get(`/api/new-to-chart${qs({ scope: scopeId })}`), [scopeId]);
  if (q.error) return <State kind="error">{q.error.message}</State>;
  if (!q.data) return <State kind="loading" />;
  const d: any = q.data;
  if (!d.comparedDay) return <State title="Needs at least two snapshots">New-to-chart compares the latest snapshot with the previous comparable one in the same scope.</State>;
  return (
    <div>
      <p className="small muted">
        In the {d.day} chart but not in the previous comparable snapshot ({d.comparedDay}). <strong>New to chart is not the same as newly released</strong> — see the release date column.
      </p>
      {d.rows.length ? (
        <DataTable
          rows={d.rows}
          rowKey={(r: any) => r.id}
          cols={[
            { key: 'r', label: 'Rank', num: true, render: (r: any) => '#' + r.movement.currentRank, sort: (r: any) => r.movement.currentRank },
            { key: 'a', label: 'App', render: (r: any) => <AppCell l={r} /> },
            { key: 'k', label: 'Type', render: (r: any) => <Movement m={r.movement} /> },
            { key: 'rel', label: 'Release date (store)', render: (r: any) => fmtDay(r.release_date), sort: (r: any) => r.release_date },
            { key: 'e', label: 'Explanation', render: (r: any) => <span className="small">{r.movement.explanation}</span> },
          ]}
        />
      ) : (
        <State title="No new entries" />
      )}
    </div>
  );
}

function Catalog({ sp, set, meta }: any) {
  const page = Number(sp.get('page') ?? 1);
  const params = { q: sp.get('q'), platform: sp.get('platform'), market: sp.get('market'), unified: sp.get('unified'), kind: sp.get('kind'), priceType: sp.get('priceType'), releasedAfter: sp.get('releasedAfter'), releasedBefore: sp.get('releasedBefore'), tracked: sp.get('tracked'), sort: sp.get('sort') ?? 'title', dir: sp.get('dir') ?? 'asc', page, pageSize: 50 };
  const q = useAsync(() => api.get(`/api/catalog${qs(params)}`), [JSON.stringify(params)]);
  const sortBtn = (key: string, label: string) => (
    <button onClick={() => set({ sort: key, dir: sp.get('sort') === key && sp.get('dir') !== 'desc' ? 'desc' : 'asc', page: null })} aria-label={`Sort by ${label}`}>
      {label} {sp.get('sort') === key || (key === 'title' && !sp.get('sort')) ? (sp.get('dir') === 'desc' ? '↓' : '↑') : ''}
    </button>
  );
  const d: any = q.data;
  return (
    <div>
      <div className="filters">
        <label className="f">
          Search title, publisher or store ID
          <input type="search" defaultValue={sp.get('q') ?? ''} placeholder="e.g. notes, com.example.app, 284882215" onKeyDown={(e) => e.key === 'Enter' && set({ q: (e.target as HTMLInputElement).value, page: null })} onBlur={(e) => e.target.value !== (sp.get('q') ?? '') && set({ q: e.target.value, page: null })} style={{ minWidth: 280 }} />
        </label>
        <label className="f">
          Store
          <select value={sp.get('platform') ?? ''} onChange={(e) => set({ platform: e.target.value, page: null })}>
            <option value="">Both</option>
            <option value="ios">App Store</option>
            <option value="android">Google Play</option>
          </select>
        </label>
        <label className="f">
          Market (observed in)
          <select value={sp.get('market') ?? ''} onChange={(e) => set({ market: e.target.value, page: null })}>
            <option value="">Any</option>
            {(meta?.markets ?? []).map((m: any) => (
              <option key={m.code} value={m.code}>
                {m.code.toUpperCase()} — {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="f">
          Apps / games
          <select value={sp.get('kind') ?? ''} onChange={(e) => set({ kind: e.target.value, page: null })}>
            <option value="">All</option>
            <option value="apps">Apps</option>
            <option value="games">Games</option>
          </select>
        </label>
        <label className="f">
          Category (unified)
          <select value={sp.get('unified') ?? ''} onChange={(e) => set({ unified: e.target.value, page: null })}>
            <option value="">All tracked categories</option>
            {(meta?.unified ?? []).map((u: any) => (
              <option key={u.slug} value={u.slug}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="f">
          Price
          <select value={sp.get('priceType') ?? ''} onChange={(e) => set({ priceType: e.target.value, page: null })}>
            <option value="">Any</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        <label className="f">
          Released from
          <input type="date" value={sp.get('releasedAfter') ?? ''} onChange={(e) => set({ releasedAfter: e.target.value, page: null })} />
        </label>
        <label className="f">
          to
          <input type="date" value={sp.get('releasedBefore') ?? ''} onChange={(e) => set({ releasedBefore: e.target.value, page: null })} />
        </label>
        {!PUBLIC_MODE && (
          <label className="f" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={sp.get('tracked') === '1'} onChange={(e) => set({ tracked: e.target.checked ? '1' : null, page: null })} /> Tracked only
          </label>
        )}
      </div>
      <p className="small muted">
        Searches the local catalog (listings seen in charts, tracked, or imported). Not the full store — for apps not here, <Link to="/track">track them by URL/ID</Link> or use the official store search.
        Price, rating and installs come from the latest observation{sp.get('market') ? ` in ${sp.get('market').toUpperCase()}` : ' in any market'}.
      </p>
      {q.error ? (
        <State kind="error">{q.error.message}</State>
      ) : !d ? (
        <State kind="loading" />
      ) : !d.rows.length ? (
        <State title="No listings match">Try fewer filters, or track a new app.</State>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{sortBtn('title', 'App')}</th>
                  <th>{sortBtn('publisher', 'Publisher')}</th>
                  <th>Store category</th>
                  <th className="num">{sortBtn('price', 'Price')}</th>
                  <th className="num">{sortBtn('rating', 'Rating')}</th>
                  <th className="num" title="Ratings count — not downloads">{sortBtn('ratings', 'Ratings')}</th>
                  <th title="Displayed lifetime install threshold (Google Play). A lower bound, not an exact count.">Installs (lower bound)</th>
                  <th>{sortBtn('release', 'Released')}</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r: any) => (
                  <tr key={r.id}>
                    <td><AppCell l={r} /></td>
                    <td>{r.publisher_id ? <Link to={`/publisher/${r.publisher_id}`}>{r.publisher_name}</Link> : '—'}</td>
                    <td>{r.category_name ?? '—'}{r.unified_name && r.unified_name !== r.category_name ? <div className="small muted">→ {r.unified_name}</div> : null}</td>
                    <td className="num">{fmtPrice(r.price, r.currency)}</td>
                    <td className="num">{fmtNum(r.rating, 2)}</td>
                    <td className="num">{fmtCompact(r.rating_count)}</td>
                    <td>{r.install_band ?? '—'}</td>
                    <td>{fmtDay(r.release_date)}</td>
                    <td>{r.obs_provenance ? <><ProvBadge p={r.obs_provenance} /> <span className="small muted">{r.obs_market?.toUpperCase()} {r.obs_day}</span></> : <span className="small muted">no observation</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="small muted">
              {d.total.toLocaleString()} listings · page {d.page} of {Math.max(1, Math.ceil(d.total / d.pageSize))}
            </span>
            <button disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
              ← Prev
            </button>
            <button disabled={page * d.pageSize >= d.total} onClick={() => set({ page: String(page + 1) })}>
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
