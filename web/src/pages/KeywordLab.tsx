import { useState } from 'react';
import { ListingPicker } from '../components/ListingPicker';
import { DataTable, LocalOnly, State, useAsync, useToast } from '../components/ui';
import { api, PUBLIC_MODE } from '../lib/api';

export default function KeywordLab() {
  const toast = useToast();
  const [picked, setPicked] = useState<any[]>([]);
  const [watchlistId, setWatchlistId] = useState('');
  const [market, setMarket] = useState('');
  const [res, setRes] = useState<any>(null);
  const lists = useAsync(() => (PUBLIC_MODE ? Promise.resolve([]) : api.get<any[]>('/api/watchlists')), []);
  const kws = useAsync(() => (PUBLIC_MODE ? Promise.resolve([]) : api.get<any[]>('/api/keywords')), []);
  const [phrases, setPhrases] = useState('');
  const [group, setGroup] = useState('');
  const run = async () => {
    try {
      setRes(await api.post('/api/keywords/lab', { ids: picked.map((p) => p.id), watchlistId: watchlistId ? Number(watchlistId) : undefined, market: market || undefined }));
    } catch (e: any) {
      toast(e.message);
    }
  };
  return (
    <div>
      <h1>Keyword Lab</h1>
      <p className="sub">Candidate phrases and competitor metadata terms from listing text you are allowed to analyze. Counts describe <strong>only the selected tracked sample</strong>.</p>
      <LocalOnly feature="Keyword Lab" />
      {!PUBLIC_MODE && (
        <>
          <div className="banner warn">
            <strong>No search volume or difficulty.</strong> The sources used do not provide them. Positions are shown only when you import them from a tool or console you have access to, labeled with that source.
          </div>
          <div className="filters">
            <label className="f">Add listings<ListingPicker onPick={(l) => setPicked([...picked.filter((p) => p.id !== l.id), l])} exclude={picked.map((p) => p.id)} /></label>
            <label className="f">…or a watchlist<select value={watchlistId} onChange={(e) => setWatchlistId(e.target.value)}><option value="">none</option>{(lists.data ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name} ({w.count})</option>)}</select></label>
            <label className="f">Market text<input type="text" maxLength={2} value={market} placeholder="any" onChange={(e) => setMarket(e.target.value.toLowerCase())} style={{ width: 60 }} /></label>
            <button className="primary" disabled={!picked.length && !watchlistId} onClick={run}>Analyze sample</button>
          </div>
          {picked.length > 0 && (
            <div className="chips" style={{ marginBottom: 10 }}>
              {picked.map((p) => <button key={p.id} className="chip" aria-pressed onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>{p.title} ✕</button>)}
            </div>
          )}
          {res && (
            <div className="card">
              <p>
                Sample: <strong>{res.sampleSize}</strong> listings ({res.sampleWithDescriptions} with description text){res.market ? ` · ${res.market.toUpperCase()} metadata` : ''}. {res.note}
              </p>
              <p className="small muted">Heuristic “title crowding” = {res.crowdingFormula}. It is a property of this sample, not an official ASO difficulty score.</p>
              {res.terms.length ? (
                <DataTable
                  rows={res.terms}
                  rowKey={(t: any) => t.term}
                  initialSort={{ key: 'df', dir: 'desc' }}
                  cols={[
                    { key: 't', label: 'Term', render: (t: any) => <code>{t.term}</code>, sort: (t: any) => t.term },
                    { key: 'n', label: 'Words', num: true, render: (t: any) => t.n, sort: (t: any) => t.n },
                    { key: 'df', label: 'Listings using it', num: true, render: (t: any) => `${t.docFreq} / ${t.sampleSize}`, sort: (t: any) => t.docFreq },
                    { key: 'oc', label: 'Occurrences', num: true, render: (t: any) => t.occurrences, sort: (t: any) => t.occurrences },
                    { key: 'ti', label: 'In titles', num: true, render: (t: any) => t.inTitles, sort: (t: any) => t.inTitles },
                    { key: 'cr', label: 'Title crowding (sample)', num: true, render: (t: any) => (t.crowding * 100).toFixed(0) + '%', sort: (t: any) => t.crowding },
                    { key: 'vol', label: 'Search volume', render: () => <span className="muted small">not available</span> },
                    { key: 'add', label: '', render: (t: any) => <button className="small" onClick={async () => { await api.post('/api/keywords', { phrases: [t.term], group: 'from lab' }); kws.reload(); toast(`Added “${t.term}”`); }}>+ group</button> },
                  ]}
                />
              ) : (
                <State title="No repeated terms">Terms must appear in at least two listings of the sample.</State>
              )}
            </div>
          )}
          <h2>Keyword groups</h2>
          <div className="filters">
            <label className="f" style={{ flex: 1 }}>Phrases (one per line)<textarea value={phrases} onChange={(e) => setPhrases(e.target.value)} style={{ minHeight: 60 }} /></label>
            <label className="f">Group<input type="text" value={group} onChange={(e) => setGroup(e.target.value)} /></label>
            <button disabled={!phrases.trim()} onClick={async () => { await api.post('/api/keywords', { phrases: phrases.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), group: group || null }); setPhrases(''); kws.reload(); }}>Add</button>
            <a href="#/data?tab=import&kind=keywords">Import user-owned keyword data (CSV) →</a>
          </div>
          {!kws.data?.length ? <State title="No keywords yet" /> : (
            <DataTable
              rows={kws.data}
              rowKey={(k: any) => k.id}
              cols={[
                { key: 'g', label: 'Group', render: (k: any) => k.group_name ?? '—', sort: (k: any) => k.group_name },
                { key: 'p', label: 'Phrase', render: (k: any) => <code>{k.phrase}</code>, sort: (k: any) => k.phrase },
                { key: 's', label: 'Scope', render: (k: any) => `${k.platform ?? 'any store'} · ${(k.market ?? 'any').toUpperCase()}` },
                { key: 'o', label: 'Observed positions (user-supplied)', render: (k: any) => k.observations.length ? k.observations.slice(0, 3).map((o: any) => <div key={o.id} className="small">#{o.position ?? '—'} {o.title ?? ''} · {o.observed_day} · <em>{o.source}</em>{o.search_volume != null ? ` · vol ${o.search_volume} ${o.volume_unit}` : ''}</div>) : <span className="muted small">none — no verified search-position source</span> },
                { key: 'x', label: '', render: (k: any) => <button className="danger small" aria-label="Delete keyword" onClick={async () => { await api.del(`/api/keywords/${k.id}`); kws.reload(); }}>✕</button> },
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}
