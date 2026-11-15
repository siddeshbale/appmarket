import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { dayRange } from '../../../shared/ranks';
import { ListingPicker } from '../components/ListingPicker';
import { AppCell, DataTable, LineChart, Loadable, ProvBadge, State, useAsync, useToast } from '../components/ui';
import { addDays, api, localWatchlists, PUBLIC_MODE, qs } from '../lib/api';
import { fmtCompact, fmtDay, fmtNum, fmtPrice, PLATFORM_LABEL, scopeLabel, today } from '../lib/format';

export default function ListingPage() {
  const { id } = useParams();
  const [range, setRange] = useState(90);
  const to = today();
  const from = addDays(to, -(range - 1));
  const q = useAsync(() => api.get(`/api/listings/${id}${qs({ from, to })}`), [id, range]);
  return <Loadable q={q}>{(p: any) => <Profile p={p} from={from} to={to} range={range} setRange={setRange} reload={q.reload} />}</Loadable>;
}

function Profile({ p, from, to, range, setRange, reload }: any) {
  const l = p.listing;
  const toast = useToast();
  const days = useMemo(() => dayRange(from, to), [from, to]);
  const latestByMarket = useMemo(() => {
    const m = new Map<string, any>();
    for (const o of p.observations) m.set(`${o.market}|${o.provider}|${o.provenance}`, o);
    return [...m.values()];
  }, [p.observations]);
  const ratingGroups = useMemo(() => {
    const g = new Map<string, any[]>();
    for (const o of p.observations) {
      if (o.availability !== 'available' || o.rating_count == null) continue;
      const k = `${o.market.toUpperCase()} · ${o.provider} · ${o.provenance}`;
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(o);
    }
    return [...g.entries()];
  }, [p.observations]);
  const [shown, setShown] = useState<string[] | null>(null);
  const charts = p.charts.filter((c: any) => c.series.some((x: any) => x.presence !== 'no_data'));
  const visible = shown ?? charts.slice(0, 4).map((c: any) => c.scopeId);
  const track = async (v: boolean) => {
    await api.post(`/api/listings/${l.id}/track`, { tracked: v });
    toast(v ? 'Tracking' : 'Untracked');
    reload();
  };
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="row">
            {l.icon_url ? <img src={l.icon_url} alt="" width={56} height={56} style={{ borderRadius: 12 }} referrerPolicy="no-referrer" /> : null}
            <div>
              <h1>{l.title}</h1>
              <div className="sub">
                {PLATFORM_LABEL[l.platform]} · <code>{l.store_id}</code> · {l.publisher_id ? <Link to={`/publisher/${l.publisher_id}`}>{l.publisher_name}</Link> : 'publisher unknown'} · {l.category_name ?? 'category unknown'}
                {l.unified_name ? ` → ${l.unified_name}` : ''} · {l.is_game ? 'Game' : 'App'} · {l.provenance === 'user' ? <span className="badge" title="You registered this listing; each observation below carries its own label">added by you</span> : <ProvBadge p={l.provenance} />}
              </div>
            </div>
          </div>
        </div>
        <div className="row">
          {!PUBLIC_MODE && (l.tracked ? <button onClick={() => track(false)}>✓ Tracked</button> : <button className="primary" onClick={() => track(true)}>Track</button>)}
          <AddToWatchlist listingId={l.id} current={p.watchlists ?? []} onDone={reload} />
          <Link className="btn" to={`/compare?ids=${l.id}`}>Compare</Link>
          {!PUBLIC_MODE && <Link className="btn" to={`/brief?ids=${l.id}`}>Brief</Link>}
        </div>
      </div>
      <div className="grid cols-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Listing facts</h3>
          <dl className="kv">
            <dt>Release date</dt><dd>{fmtDay(l.release_date)} <span className="small muted">(store-reported)</span></dd>
            <dt>First seen here</dt><dd>{fmtDay(l.first_seen_at)}</dd>
            <dt>Last seen</dt><dd>{fmtDay(l.last_seen_at)}</dd>
            <dt>Store links</dt>
            <dd className="row">
              {(p.links?.store ?? []).map((s: any) => (
                <a key={s.market} href={s.url} target="_blank" rel="noreferrer noopener">{s.market.toUpperCase()} ↗</a>
              ))}
            </dd>
            {p.links?.adLibraries?.length ? (
              <>
                <dt>Ad libraries</dt>
                <dd className="row">{p.links.adLibraries.map((a: any) => <a key={a.label} href={a.url} target="_blank" rel="noreferrer noopener" title={a.note}>{a.label} ↗</a>)}</dd>
              </>
            ) : null}
          </dl>
        </div>
        <CrossStore p={p} reload={reload} />
      </div>

      <h2>Latest metadata by market</h2>
      {latestByMarket.length ? (
        <DataTable
          rows={latestByMarket}
          rowKey={(o: any) => `${o.market}${o.provider}${o.provenance}`}
          cols={[
            { key: 'm', label: 'Market', render: (o: any) => o.market.toUpperCase(), sort: (o: any) => o.market },
            { key: 'd', label: 'Observed', render: (o: any) => <>{o.snapshot_day} <ProvBadge p={o.provenance} /></>, sort: (o: any) => o.snapshot_day },
            { key: 'a', label: 'Availability', render: (o: any) => (o.availability === 'available' ? 'available' : <span className="badge warn">{o.availability}</span>) },
            { key: 'p', label: 'Price', num: true, render: (o: any) => fmtPrice(o.price, o.currency) },
            { key: 'r', label: 'Rating', num: true, render: (o: any) => fmtNum(o.rating, 2) },
            { key: 'rc', label: 'Ratings (count)', num: true, render: (o: any) => <span title={o.rating_scope ?? ''}>{fmtCompact(o.rating_count)}</span> },
            { key: 'i', label: 'Installs (lifetime lower bound)', render: (o: any) => o.install_band ?? '—' },
            { key: 'v', label: 'Version', render: (o: any) => o.version ?? '—' },
            { key: 'u', label: 'Store update', render: (o: any) => fmtDay(o.store_updated_at) },
            { key: 'f', label: 'Disclosed', render: (o: any) => [o.has_ads === 1 && 'ads', o.has_iap === 1 && 'IAP'].filter(Boolean).join(', ') || '—' },
            { key: 's', label: 'Source', render: (o: any) => (o.source_url?.startsWith('https://') ? <a href={o.source_url} target="_blank" rel="noreferrer noopener">{o.provider} ↗</a> : <span className="small">{o.provider}</span>) },
          ]}
        />
      ) : (
        <State title="No metadata observations yet">{l.platform === 'android' ? 'Run ingestion (registered packages are read daily if the Google Play reader is enabled), add a manual observation below, or import history.' : 'Run ingestion or look the app up again from Track.'}</State>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        <h2 style={{ margin: 0 }}>Chart history</h2>
        <span className="spacer" />
        <label className="f">
          Window
          <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>365 days</option>
          </select>
        </label>
      </div>
      {charts.length ? (
        <>
          <div className="chips" role="group" aria-label="Chart scopes">
            {charts.map((c: any) => (
              <button key={c.scopeId} className="chip" aria-pressed={visible.includes(c.scopeId)} onClick={() => setShown(visible.includes(c.scopeId) ? visible.filter((x: string) => x !== c.scopeId) : [...visible, c.scopeId])}>
                {scopeLabel(c.scope, c.categoryName)} {c.best ? `· best #${c.best}` : ''}
              </button>
            ))}
          </div>
          <p className="small muted">Each scope is drawn separately — ranks from different stores, markets, devices or categories are never combined.</p>
          <div className="grid cols-2">
            {charts.filter((c: any) => visible.includes(c.scopeId)).map((c: any) => (
              <div className="card" key={c.scopeId}>
                <div className="row"><strong className="small">{scopeLabel(c.scope, c.categoryName)}</strong><ProvBadge p={c.scope.provenance} /></div>
                <LineChart invert days={days} yLabel="rank" series={[{ name: 'rank', points: c.series.map((s: any) => ({ day: s.day, value: s.rank, presence: s.presence })) }]} />
                <div className="small muted">
                  Ranked {c.series.filter((s: any) => s.presence === 'ranked').length} of {c.series.filter((s: any) => s.presence === 'ranked' || s.presence === 'absent').length} fetched days ·
                  latest: {c.latest ? (c.latest.rank ? `#${c.latest.rank}` : c.latest.presence) + ` (${c.latest.day})` : 'n/a'}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <State title="No chart observations in this window">Appearing in a chart requires a fetched chart in that scope. Absence from charts is not evidence of low performance.</State>
      )}

      <h2>Rating count &amp; rating history</h2>
      <p className="small muted">Rating counts are cumulative store ratings for the stated scope — not downloads. Different markets/providers are separate lines, never summed.</p>
      {ratingGroups.length ? (
        <div className="grid cols-2">
          <div className="card">
            <strong className="small">Ratings count</strong>
            <LineChart days={days} yLabel="ratings" series={ratingGroups.map(([k, obs]) => ({ name: k, points: obs.map((o: any) => ({ day: o.snapshot_day, value: o.rating_count })) }))} />
          </div>
          <div className="card">
            <strong className="small">Average rating</strong>
            <LineChart days={days} yLabel="stars" series={ratingGroups.map(([k, obs]) => ({ name: k, points: obs.map((o: any) => ({ day: o.snapshot_day, value: o.rating })) }))} />
          </div>
        </div>
      ) : (
        <State title="No rating observations" />
      )}

      <details style={{ marginTop: 16 }}>
        <summary>All observations ({p.observations.length}) — price, version and update history</summary>
        <DataTable
          rows={[...p.observations].reverse()}
          rowKey={(o: any) => o.id ?? `${o.market}${o.snapshot_day}${o.provider}`}
          cols={[
            { key: 'd', label: 'Day', render: (o: any) => o.snapshot_day, sort: (o: any) => o.snapshot_day },
            { key: 'm', label: 'Market', render: (o: any) => o.market.toUpperCase(), sort: (o: any) => o.market },
            { key: 'src', label: 'Source', render: (o: any) => <>{o.provider} <ProvBadge p={o.provenance} /></> },
            { key: 'p', label: 'Price', num: true, render: (o: any) => fmtPrice(o.price, o.currency) },
            { key: 'v', label: 'Version', render: (o: any) => o.version ?? '—' },
            { key: 'u', label: 'Store update', render: (o: any) => fmtDay(o.store_updated_at) },
            { key: 'r', label: 'Rating', num: true, render: (o: any) => fmtNum(o.rating, 2) },
            { key: 'rc', label: 'Ratings', num: true, render: (o: any) => fmtNum(o.rating_count) },
            { key: 'i', label: 'Installs', render: (o: any) => o.install_band ?? '—' },
          ]}
        />
      </details>

      {!PUBLIC_MODE && <ManualObservation l={l} onDone={reload} />}

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        {!PUBLIC_MODE && <Notes p={p} reload={reload} />}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Evidence &amp; onboarding</h3>
          {(p.evidence ?? []).length ? (
            <ul>
              {p.evidence.map((e: any, i: number) => (
                <li key={e.id ?? i}>
                  <span className="badge">{e.kind}</span> {e.channel} — {e.hook ?? '(no hook)'} {e.url && <a href={e.url} target="_blank" rel="noreferrer noopener">link ↗</a>} <span className="small muted">{e.first_observed}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No evidence recorded.</p>
          )}
          {(p.teardowns ?? []).map((t: any) => (
            <div key={t.id} className="small" style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 6 }}>
              <strong>Teardown {t.version_label ?? ''}</strong> ({t.observed_at}): first action “{t.first_meaningful_action ?? '—'}”, paywall {t.paywall_timing ?? '—'}, trial {t.trial_terms ?? '—'}, pricing {t.pricing ?? '—'}
            </div>
          ))}
          {!PUBLIC_MODE && <Link to={`/evidence?listingId=${l.id}`}>Add evidence or teardown →</Link>}
        </div>
      </div>

      {(p.firstParty ?? []).length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Your first-party metrics <span className="badge user">User-supplied · private</span></h3>
          <p className="small muted">From your own console exports. Never included in the public export.</p>
          {[...new Set(p.firstParty.map((m: any) => m.metric))].map((metric: any) => (
            <div key={metric}>
              <strong className="small">{metric}</strong>
              <LineChart days={days} series={[{ name: metric, points: p.firstParty.filter((m: any) => m.metric === metric).map((m: any) => ({ day: m.day, value: m.value })) }]} />
            </div>
          ))}
        </div>
      )}

      <h2>Other listings by this publisher</h2>
      {p.related.length ? (
        <div className="grid cols-3">
          {p.related.map((r: any) => (
            <div className="card" key={r.id}>
              <AppCell l={r} />
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">None in the local catalog.</p>
      )}
    </div>
  );
}

function AddToWatchlist({ listingId, current, onDone }: { listingId: number; current: any[]; onDone: () => void }) {
  const toast = useToast();
  const lists = useAsync(() => (PUBLIC_MODE ? Promise.resolve(localWatchlists.load().map((w, i) => ({ id: i, name: w.name }))) : api.get<any[]>('/api/watchlists')), []);
  const add = async (v: string) => {
    if (!v) return;
    if (PUBLIC_MODE) {
      const all = localWatchlists.load();
      if (v === '__new') all.push({ name: 'My list', ids: [listingId] });
      else if (!all[Number(v)].ids.includes(listingId)) all[Number(v)].ids.push(listingId);
      localWatchlists.save(all);
      toast('Saved to a watchlist in this browser');
      return;
    }
    if (v === '__new') {
      const name = prompt('New watchlist name');
      if (!name) return;
      const r = await api.post('/api/watchlists', { name });
      await api.post(`/api/watchlists/${r.id}/items`, { listingId });
    } else await api.post(`/api/watchlists/${v}/items`, { listingId });
    toast('Added to watchlist');
    onDone();
    lists.reload();
  };
  return (
    <select value="" onChange={(e) => add(e.target.value)} aria-label="Add to watchlist">
      <option value="">+ Watchlist{current.length ? ` (in ${current.map((c) => c.name).join(', ')})` : ''}</option>
      {(lists.data ?? []).map((w: any) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
      <option value="__new">New watchlist…</option>
    </select>
  );
}

function CrossStore({ p, reload }: any) {
  const toast = useToast();
  const set = async (id: number, status: string) => {
    await api.post(`/api/links/${id}`, { status });
    toast(status === 'verified' ? 'Link verified' : 'Suggestion rejected');
    reload();
  };
  const verified = p.crossStore.filter((c: any) => c.status === 'verified');
  const suggested = p.crossStore.filter((c: any) => c.status === 'suggested');
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Cross-store listings</h3>
      <p className="small muted">Shown only after verification. Ratings and ranks from different stores are never combined.</p>
      {verified.map((c: any) => (
        <div key={c.id} className="row">
          <span className="badge ok">verified</span> <AppCell l={c.listing} />
        </div>
      ))}
      {!verified.length && <p className="small muted">No verified counterpart.</p>}
      {!PUBLIC_MODE && suggested.length > 0 && (
        <>
          <h3>Suggestions to review</h3>
          {suggested.map((c: any) => (
            <div key={c.id} style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}>
              <AppCell l={c.listing} />
              <ul className="small">
                {c.evidence.map((e: any, i: number) => (
                  <li key={i}>
                    <span className="badge">{e.strength}</span> {e.detail}
                  </li>
                ))}
              </ul>
              <div className="row">
                <button onClick={() => set(c.id, 'verified')}>Verify</button>
                <button onClick={() => set(c.id, 'rejected')}>Reject</button>
              </div>
            </div>
          ))}
        </>
      )}
      {!PUBLIC_MODE && <ManualLink p={p} reload={reload} />}
    </div>
  );
}

function ManualLink({ p, reload }: any) {
  const toast = useToast();
  const [note, setNote] = useState('');
  return (
    <details>
      <summary className="small">Link a counterpart manually</summary>
      <div className="row" style={{ marginTop: 6 }}>
        <input type="text" placeholder="Evidence (e.g. same developer website)" value={note} onChange={(e) => setNote(e.target.value)} />
        <ListingPicker
          platform={p.listing.platform === 'ios' ? 'android' : 'ios'}
          placeholder={`Find the ${p.listing.platform === 'ios' ? 'Android' : 'iOS'} listing…`}
          onPick={async (o) => {
            try {
              await api.post('/api/links', { a: p.listing.id, b: o.id, note });
              toast('Linked and marked verified');
              reload();
            } catch (e: any) {
              toast(e.message);
            }
          }}
        />
      </div>
    </details>
  );
}

function Notes({ p, reload }: any) {
  const [body, setBody] = useState('');
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Private notes <span className="badge">local only</span></h3>
      <p className="small muted">Notes never modify source observations and are never exported publicly.</p>
      {(p.notes ?? []).map((n: any) => (
        <div key={n.id} className="row small" style={{ borderTop: '1px solid var(--border)', padding: '4px 0' }}>
          <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{n.body}</span>
          <span className="muted">{n.created_at.slice(0, 10)}</span>
          <button className="danger" aria-label="Delete note" onClick={async () => (await api.del(`/api/notes/${n.id}`), reload())}>
            ✕
          </button>
        </div>
      ))}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note…" style={{ fontFamily: 'inherit' }} aria-label="New note" />
      <button disabled={!body.trim()} onClick={async () => (await api.post(`/api/listings/${p.listing.id}/notes`, { body }), setBody(''), reload())}>
        Save note
      </button>
    </div>
  );
}

function ManualObservation({ l, onDone }: any) {
  const toast = useToast();
  const [f, setF] = useState<any>({ market: 'us', observedDay: today() });
  const num = (v: string) => (v === '' ? null : Number(v));
  const submit = async () => {
    try {
      await api.post(`/api/listings/${l.id}/observations`, {
        market: f.market, observedDay: f.observedDay, title: f.title || null, publisher: f.publisher || null, price: num(f.price ?? ''), currency: f.currency || null,
        rating: num(f.rating ?? ''), ratingCount: num(f.ratingCount ?? ''), installBand: f.installBand || null, version: f.version || null, updatedAt: f.updatedAt || null,
        hasAds: f.hasAds === '' || f.hasAds === undefined ? null : f.hasAds === 'yes', hasIap: f.hasIap === '' || f.hasIap === undefined ? null : f.hasIap === 'yes', sourceUrl: f.sourceUrl || null,
      });
      toast('Manual observation saved (labeled User-supplied)');
      onDone();
    } catch (e: any) {
      toast(e.message);
    }
  };
  const inp = (k: string, label: string, type = 'text', ph = '') => (
    <label className="f">
      {label}
      <input type={type} value={f[k] ?? ''} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} step={type === 'number' ? 'any' : undefined} />
    </label>
  );
  return (
    <details className="card" style={{ marginTop: 12 }}>
      <summary>Add a manual observation (structured form)</summary>
      <p className="small muted">For data you saw yourself — e.g. an Android listing when the automated reader is off or failed. Stored as User-supplied, separate from observed data.</p>
      <div className="formgrid">
        {inp('market', 'Market (2-letter)', 'text', 'us')}
        {inp('observedDay', 'Observed day', 'date')}
        {inp('title', 'Title')}
        {inp('publisher', 'Publisher')}
        {inp('price', 'Price', 'number')}
        {inp('currency', 'Currency', 'text', 'USD')}
        {inp('rating', 'Rating (0–5)', 'number')}
        {inp('ratingCount', 'Ratings count', 'number')}
        {inp('installBand', 'Install threshold shown', 'text', '1M+')}
        {inp('version', 'Version')}
        {inp('updatedAt', 'Store "updated on"', 'date')}
        {inp('sourceUrl', 'Source URL', 'url', 'https://')}
        <label className="f">
          Contains ads
          <select value={f.hasAds ?? ''} onChange={(e) => setF({ ...f, hasAds: e.target.value })}>
            <option value="">unknown</option><option value="yes">yes</option><option value="no">no</option>
          </select>
        </label>
        <label className="f">
          In-app purchases
          <select value={f.hasIap ?? ''} onChange={(e) => setF({ ...f, hasIap: e.target.value })}>
            <option value="">unknown</option><option value="yes">yes</option><option value="no">no</option>
          </select>
        </label>
      </div>
      <button className="primary" style={{ marginTop: 8 }} onClick={submit} disabled={!/^[a-z]{2}$/.test(f.market) || !f.observedDay}>
        Save observation
      </button>
    </details>
  );
}
