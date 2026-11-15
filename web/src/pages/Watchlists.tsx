import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ListingPicker } from '../components/ListingPicker';
import { State, useAsync, useToast } from '../components/ui';
import { api, localWatchlists, PUBLIC_MODE } from '../lib/api';

export default function Watchlists() {
  const [tab, setTab] = useState<'lists' | 'alerts'>('lists');
  return (
    <div>
      <h1>Watchlists &amp; alerts</h1>
      <p className="sub">Alerts are generated locally after successful ingestion — no email or push notifications are sent.</p>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'lists'} onClick={() => setTab('lists')}>Watchlists</button>
        <button role="tab" aria-selected={tab === 'alerts'} onClick={() => setTab('alerts')}>Alerts</button>
      </div>
      {PUBLIC_MODE ? <PublicLists /> : tab === 'lists' ? <Lists /> : <Alerts />}
    </div>
  );
}

function PublicLists() {
  const [lists, setLists] = useState(localWatchlists.load());
  const save = (v: typeof lists) => (localWatchlists.save(v), setLists(v));
  return (
    <div>
      <div className="banner public">Stored in: <strong>{localWatchlists.where}</strong> Alerts require the local app.</div>
      {!lists.length && <State title="No watchlists yet">Use “+ Watchlist” on any listing page.</State>}
      {lists.map((w, i) => (
        <div className="card" key={i}>
          <div className="row"><strong>{w.name}</strong><span className="spacer" /><button className="danger" onClick={() => save(lists.filter((_, j) => j !== i))}>Delete</button></div>
          <ul>
            {w.ids.map((id) => (
              <li key={id}>
                <Link to={`/listing/${id}`}>Listing #{id}</Link> <button className="small" onClick={() => save(lists.map((x, j) => (j === i ? { ...x, ids: x.ids.filter((y) => y !== id) } : x)))}>remove</button>
              </li>
            ))}
          </ul>
          <Link to={`/compare?ids=${w.ids.slice(0, 5).join(',')}`}>Compare first five →</Link>
        </div>
      ))}
    </div>
  );
}

function Lists() {
  const toast = useToast();
  const q = useAsync(() => api.get<any[]>('/api/watchlists'), []);
  const [name, setName] = useState('');
  const create = async () => {
    try {
      await api.post('/api/watchlists', { name });
      setName('');
      q.reload();
    } catch (e: any) {
      toast(e.message);
    }
  };
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="New watchlist name" aria-label="New watchlist name" />
        <button className="primary" disabled={!name.trim()} onClick={create}>Create</button>
      </div>
      {q.data && !q.data.length && <State title="No watchlists yet">Create one, then add listings here or from a listing page.</State>}
      {(q.data ?? []).map((w: any) => (
        <WatchlistCard key={w.id} w={w} reload={q.reload} />
      ))}
    </div>
  );
}

function WatchlistCard({ w, reload }: any) {
  const toast = useToast();
  const [notes, setNotes] = useState(w.notes ?? '');
  const [tags, setTags] = useState(w.tags ?? '');
  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>{w.name}</h2>
        <span className="badge">{w.count} listings</span>
        <span className="spacer" />
        {w.items.length > 0 && <Link className="btn" to={`/compare?ids=${w.items.slice(0, 5).map((i: any) => i.listing_id).join(',')}`}>Compare</Link>}
        {w.items.length > 0 && <Link className="btn" to={`/brief?ids=${w.items.map((i: any) => i.listing_id).join(',')}`}>Brief</Link>}
        <button className="danger" onClick={async () => { if (confirm(`Delete watchlist “${w.name}”? Listings and history are kept.`)) { await api.del(`/api/watchlists/${w.id}`); reload(); } }}>Delete list</button>
      </div>
      <div className="formgrid" style={{ marginTop: 8 }}>
        <label className="f">Notes<input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <label className="f">Tags (comma separated)<input type="text" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        <div className="row" style={{ alignItems: 'flex-end' }}><button onClick={async () => { await api.patch(`/api/watchlists/${w.id}`, { notes, tags }); toast('Saved'); }}>Save</button></div>
      </div>
      <ul>
        {w.items.map((i: any) => (
          <li key={i.listing_id} className="row">
            <Link to={`/listing/${i.listing_id}`}>{i.title}</Link> <span className="small muted">{i.platform === 'ios' ? 'iOS' : 'Android'} · {i.publisher_name ?? i.store_id}</span>
            <button className="small" onClick={async () => { await api.del(`/api/watchlists/${w.id}/items/${i.listing_id}`); reload(); }}>remove</button>
          </li>
        ))}
      </ul>
      <ListingPicker exclude={w.items.map((i: any) => i.listing_id)} placeholder="Add a listing…" onPick={async (l) => { await api.post(`/api/watchlists/${w.id}/items`, { listingId: l.id }); reload(); }} />
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = { new_chart_entry: 'New chart entry', rank_move: 'Rank movement', price_change: 'Price change', update: 'App update' };

function Alerts() {
  const q = useAsync(() => api.get<any[]>('/api/alerts'), []);
  const [type, setType] = useState('');
  const rows = (q.data ?? []).filter((a) => !type || a.type === type);
  return (
    <div>
      <div className="filters">
        <label className="f">
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button onClick={async () => { await api.post('/api/alerts/read-all'); q.reload(); }}>Mark all read</button>
        <button onClick={async () => { await api.post('/api/alerts/generate'); q.reload(); }}>Re-check now</button>
        <span className="small muted">Threshold and rules: see Data &amp; settings. Duplicate alerts are suppressed by key.</span>
      </div>
      {!rows.length ? (
        <State title="No alerts">Alerts appear for watchlisted listings after ingestion: new chart entries, rank moves above the threshold, observed price changes and app updates.</State>
      ) : (
        rows.map((a) => (
          <div className="card" key={a.id} style={{ opacity: a.read_at ? 0.7 : 1 }}>
            <div className="row">
              <span className="badge">{TYPE_LABEL[a.type] ?? a.type}</span>
              <strong>{a.message}</strong>
              <span className="spacer" />
              <span className="small muted">{a.created_at.slice(0, 16).replace('T', ' ')} UTC</span>
              {!a.read_at && <button className="small" onClick={async () => { await api.post(`/api/alerts/${a.id}/read`); q.reload(); }}>Mark read</button>}
            </div>
            <details>
              <summary className="small">Evidence</summary>
              <pre className="pre">{JSON.stringify(a.evidence, null, 2)}</pre>
              {a.listing_id && <Link to={`/listing/${a.listing_id}`}>Open listing →</Link>}
            </details>
          </div>
        ))
      )}
    </div>
  );
}
