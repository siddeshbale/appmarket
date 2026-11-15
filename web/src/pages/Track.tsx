import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LocalOnly, useToast } from '../components/ui';
import { api } from '../lib/api';
import { fmtCompact, fmtNum, fmtPrice } from '../lib/format';
import { useMeta } from '../lib/meta';

export default function Track() {
  const meta = useMeta();
  const nav = useNavigate();
  const toast = useToast();
  const markets = (meta?.markets ?? []).filter((m: any) => m.enabled);
  const [market, setMarket] = useState('us');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState<any>(null);

  const lookup = async (value = input) => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.post('/api/lookup', { input: value, market });
      setResult(r);
      if (r.status === 'fetched') toast('Listing fetched and tracked');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const doSearch = async () => {
    setBusy(true);
    setErr(null);
    try {
      setSearch(await api.post('/api/search/apple', { term, market }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <h1>Track an app</h1>
      <p className="sub">Register any listing for tracking — this covers the long tail beyond charts. Only App Store and Google Play URLs/IDs are accepted; the server rebuilds request URLs itself and never fetches arbitrary links.</p>
      <LocalOnly feature="Tracking" />
      <div className="card">
        <h2 style={{ marginTop: 0 }}>By store URL or ID</h2>
        <div className="row">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && input && lookup()} placeholder="https://apps.apple.com/us/app/…/id123456789  ·  com.example.app  ·  https://play.google.com/store/apps/details?id=…" style={{ flex: 1, minWidth: 320 }} aria-label="Store URL or ID" />
          <label className="f">
            Market
            <select value={market} onChange={(e) => setMarket(e.target.value)}>
              {markets.map((m: any) => (
                <option key={m.code} value={m.code}>
                  {m.code.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={!input || busy} onClick={() => lookup()}>
            {busy ? 'Working…' : 'Look up & track'}
          </button>
        </div>
        {err && <div className="banner bad" style={{ marginTop: 10 }}>{err}</div>}
        {result && (
          <div className="banner" style={{ marginTop: 10, background: 'var(--panel-2)' }}>
            {result.note && <p><strong>Note:</strong> {result.note}</p>}
            {result.status === 'fetched' && <p>Fetched metadata for {market.toUpperCase()} and added to the tracked set.</p>}
            {result.status === 'unavailable_in_market' && <p>The listing is not available in the {market.toUpperCase()} storefront (recorded as “unavailable”, not as missing data). It remains tracked.</p>}
            {result.status === 'registered_without_fetch' && <p>Registered without fetching ({result.reason ?? 'no fetch requested'}). Add a manual observation or import history on the listing page.</p>}
            {result.status === 'registered_fetch_failed' && (
              <p>
                Registered, but the automated read failed (<code>{result.errorClass}</code>: {result.reason}). The listing still works for history, comparison and exports — add a{' '}
                <strong>manual observation</strong> on its page or import CSV/JSON.
              </p>
            )}
            <div className="row">
              <Link className="btn primary" to={`/listing/${result.listingId}`}>
                Open listing →
              </Link>
              {result.fallback?.storeUrl && (
                <a className="btn" href={result.fallback.storeUrl} target="_blank" rel="noreferrer noopener">
                  Open store page ↗
                </a>
              )}
              {result.fallback?.playSearch && (
                <a className="btn" href={result.fallback.playSearch} target="_blank" rel="noreferrer noopener">
                  Official Play search ↗
                </a>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Search the App Store ({market.toUpperCase()})</h2>
        <p className="small muted">Uses the iTunes Search API, scoped to the selected country. Result order is the API's, not App Store search ranking, and is never stored as a keyword position.</p>
        <div className="row">
          <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && term && doSearch()} placeholder="App title or developer" aria-label="App Store search term" style={{ minWidth: 300 }} />
          <button disabled={!term || busy || meta?.mode === 'demo'} onClick={doSearch}>
            Search
          </button>
          {meta?.mode === 'demo' && <span className="small muted">Disabled in demo mode (no live requests).</span>}
        </div>
        {search && (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data">
              <thead>
                <tr><th>App</th><th>Developer</th><th>Genre</th><th className="num">Price</th><th className="num">Rating</th><th className="num">Ratings</th><th /></tr>
              </thead>
              <tbody>
                {search.rows.map((r: any) => (
                  <tr key={r.storeId}>
                    <td>{r.title}</td>
                    <td>{r.publisherName}</td>
                    <td>{r.categoryName}</td>
                    <td className="num">{fmtPrice(r.price, r.currency)}</td>
                    <td className="num">{fmtNum(r.rating, 2)}</td>
                    <td className="num">{fmtCompact(r.ratingCount)}</td>
                    <td><button onClick={() => lookup(r.storeId)}>Track</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Google Play search</h2>
        <p className="small muted">Automated Play search is not supported (the search path is disallowed for crawlers). Search on Google Play yourself, then paste the app's URL above.</p>
        <PlaySearchLink market={market} />
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Bulk</h2>
        <p>
          Register many apps at once with the <Link to="/data?tab=import">Listings import</Link> (CSV/JSON). <button onClick={() => nav('/data?tab=import')}>Open import</button>
        </p>
      </div>
    </div>
  );
}

function PlaySearchLink({ market }: { market: string }) {
  const [t, setT] = useState('');
  return (
    <div className="row">
      <input type="search" value={t} onChange={(e) => setT(e.target.value)} placeholder="Search term" aria-label="Google Play search term" />
      <a className="btn" href={`https://play.google.com/store/search?q=${encodeURIComponent(t)}&c=apps&gl=${market.toUpperCase()}`} target="_blank" rel="noreferrer noopener" aria-disabled={!t}>
        Open Google Play search ↗
      </a>
    </div>
  );
}
