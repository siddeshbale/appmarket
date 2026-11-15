import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ListingPicker } from '../components/ListingPicker';
import { LocalOnly, State, useAsync, useToast } from '../components/ui';
import { addDays, api, PUBLIC_MODE } from '../lib/api';
import { today } from '../lib/format';

export default function ResearchBrief() {
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const ids = (sp.get('ids') ?? '').split(',').map(Number).filter((n) => n > 0).slice(0, 50);
  const [from, setFrom] = useState(addDays(today(), -29));
  const [to, setTo] = useState(today());
  const [title, setTitle] = useState('Competitive research brief');
  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeEvidence, setIncludeEvidence] = useState(true);
  const [out, setOut] = useState<any>(null);
  const names = useAsync(() => Promise.all(ids.map((id) => api.get(`/api/listings/${id}`).then((p: any) => ({ id, title: p.listing.title }), () => ({ id, title: `#${id}` })))), [ids.join(',')]);
  const gen = async () => {
    try {
      setOut(await api.post('/api/brief', { ids, from, to, title, includeNotes, includeEvidence }));
    } catch (e: any) {
      toast(e.message);
    }
  };
  const copy = async (s: string, what: string) => {
    try {
      await navigator.clipboard.writeText(s);
      toast(`${what} copied`);
    } catch {
      toast('Clipboard unavailable — select the text and copy manually');
    }
  };
  const download = (s: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([s], { type: 'text/markdown' }));
    a.download = `research-brief-${to}.md`;
    a.click();
  };
  return (
    <div>
      <h1>Research brief</h1>
      <p className="sub">A deterministic, source-linked Markdown brief from your selection, plus a copyable analysis prompt for Claude or ChatGPT. No AI API is called and nothing is sent anywhere — you decide what to paste.</p>
      <LocalOnly feature="Brief generation" />
      {!PUBLIC_MODE && (
        <>
          <div className="filters">
            <label className="f">Add listings ({ids.length})<ListingPicker exclude={ids} onPick={(l) => setSp({ ids: [...ids, l.id].join(',') })} /></label>
            <label className="f">Title<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="f">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="f">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <label className="row small"><input type="checkbox" checked={includeEvidence} onChange={(e) => setIncludeEvidence(e.target.checked)} /> Evidence</label>
            <label className="row small"><input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} /> Include private notes</label>
            <button className="primary" disabled={!ids.length} onClick={gen}>Generate</button>
          </div>
          <div className="chips">
            {(names.data ?? []).map((n: any) => <button key={n.id} className="chip" aria-pressed onClick={() => setSp({ ids: ids.filter((x) => x !== n.id).join(',') })}>{n.title} ✕</button>)}
          </div>
          {includeNotes && <div className="banner warn" style={{ marginTop: 8 }}>Private notes will be included in the text below. Review before pasting it anywhere.</div>}
          {!out ? (
            <State title="Select listings and generate">Tip: open a watchlist and click “Brief”.</State>
          ) : (
            <div className="grid cols-2" style={{ marginTop: 12 }}>
              <div className="card">
                <div className="row"><h3 style={{ margin: 0 }}>Brief (Markdown)</h3><span className="spacer" /><button onClick={() => copy(out.markdown, 'Brief')}>Copy</button><button onClick={() => download(out.markdown)}>Download .md</button></div>
                <pre className="pre">{out.markdown}</pre>
              </div>
              <div className="card">
                <div className="row"><h3 style={{ margin: 0 }}>Analysis prompt</h3><span className="spacer" /><button onClick={() => copy(out.prompt, 'Prompt')}>Copy prompt</button></div>
                <p className="small muted">Asks for observations, hypotheses, missing data and testable opportunities — and tells the model not to convert ranks into downloads or revenue.</p>
                <pre className="pre">{out.prompt}</pre>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
