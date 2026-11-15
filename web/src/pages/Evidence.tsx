import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adLibraryLinks } from '../../../shared/storeUrls';
import { ListingPicker } from '../components/ListingPicker';
import { DataTable, LocalOnly, State, useAsync, useToast } from '../components/ui';
import { api, PUBLIC_MODE, qs } from '../lib/api';
import { today } from '../lib/format';

const KINDS: [string, string][] = [
  ['paid_ad', 'Paid ad'],
  ['organic_post', 'Organic post'],
  ['sponsorship_unverified', 'Sponsorship (unverified)'],
  ['creator', 'Creator / publisher link'],
  ['screenshot', 'Screenshot reference'],
  ['store_page', 'Store page'],
  ['other', 'Other'],
];

export default function Evidence() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'ads';
  const set = (k: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [a, b] of Object.entries(k)) {
      if (b) n.set(a, b);
      else n.delete(a);
    }
    setSp(n, { replace: true });
  };
  return (
    <div>
      <h1>Ads, creators &amp; onboarding</h1>
      <p className="sub">An evidence library of references — links, notes and explicitly displayed metrics. No media is copied by default, and nothing here is converted into spend, sales, ROAS or conversion.</p>
      <LocalOnly feature="The evidence library" />
      <div className="tabs" role="tablist">
        {[['ads', 'Ads & social evidence'], ['onboarding', 'Onboarding teardowns'], ['libraries', 'Ad library search links']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => set({ tab: k })}>{l}</button>
        ))}
      </div>
      {!PUBLIC_MODE && tab === 'ads' && <AdsTab sp={sp} set={set} />}
      {!PUBLIC_MODE && tab === 'onboarding' && <Onboarding sp={sp} />}
      {tab === 'libraries' && <Libraries />}
    </div>
  );
}

function AdsTab({ sp, set }: any) {
  const filters = { q: sp.get('q'), kind: sp.get('kind'), channel: sp.get('channel'), market: sp.get('market'), tag: sp.get('tag'), from: sp.get('from'), to: sp.get('to'), listingId: sp.get('listingId') };
  const q = useAsync(() => api.get<any[]>(`/api/evidence${qs(filters)}`), [JSON.stringify(filters)]);
  return (
    <div>
      <AddEvidence onDone={q.reload} listingId={sp.get('listingId') ? Number(sp.get('listingId')) : null} />
      <div className="filters">
        <label className="f">Search<input type="search" defaultValue={filters.q ?? ''} onKeyDown={(e) => e.key === 'Enter' && set({ q: (e.target as HTMLInputElement).value })} placeholder="hook, advertiser, app, tag…" /></label>
        <label className="f">Type<select value={filters.kind ?? ''} onChange={(e) => set({ kind: e.target.value })}><option value="">All</option>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="f">Channel<input type="text" value={filters.channel ?? ''} onChange={(e) => set({ channel: e.target.value })} placeholder="meta, tiktok…" style={{ width: 110 }} /></label>
        <label className="f">Market<input type="text" maxLength={2} value={filters.market ?? ''} onChange={(e) => set({ market: e.target.value.toLowerCase() })} style={{ width: 60 }} /></label>
        <label className="f">Tag<input type="text" value={filters.tag ?? ''} onChange={(e) => set({ tag: e.target.value })} style={{ width: 110 }} /></label>
        <label className="f">First seen from<input type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="f">to<input type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value })} /></label>
        {filters.listingId && <button onClick={() => set({ listingId: null })}>Clear app filter</button>}
        <Link to="/data?tab=import&kind=evidence">Bulk import →</Link>
      </div>
      {!q.data ? <State kind="loading" /> : !q.data.length ? <State title="No evidence recorded">Add references manually above, or bulk-import a CSV.</State> : (
        <DataTable
          rows={q.data}
          rowKey={(e: any) => e.id}
          cols={[
            { key: 'k', label: 'Type', render: (e: any) => <span className={`badge ${e.kind === 'sponsorship_unverified' ? 'warn' : ''}`}>{KINDS.find((k) => k[0] === e.kind)?.[1] ?? e.kind}</span>, sort: (e: any) => e.kind },
            { key: 'a', label: 'App / publisher', render: (e: any) => (e.listing_id ? <Link to={`/listing/${e.listing_id}`}>{e.listing_title}</Link> : e.advertiser ?? '—'), sort: (e: any) => e.listing_title },
            { key: 'c', label: 'Channel · market', render: (e: any) => `${e.channel ?? '—'} · ${(e.market ?? '—').toUpperCase()}` },
            { key: 'h', label: 'Hook / format', render: (e: any) => <><div>{e.hook ?? '—'}</div><div className="small muted">{e.format} {e.creator ? `· ${e.creator}` : ''}</div></> },
            { key: 'm', label: 'Displayed metrics (as labeled by source)', render: (e: any) => e.metrics.length ? e.metrics.map((m: any, i: number) => <div key={i} className="small">{m.label}: <strong>{m.value}</strong> {m.scope && <span className="muted">({m.scope})</span>}</div>) : <span className="muted small">none</span> },
            { key: 'd', label: 'First / last seen', render: (e: any) => `${e.first_observed ?? '—'} / ${e.last_observed ?? '—'}`, sort: (e: any) => e.first_observed },
            { key: 'l', label: 'Reference', render: (e: any) => <>{e.url && <a href={e.url} target="_blank" rel="noreferrer noopener">open ↗</a>} {e.local_path && <span className="small muted" title="Local-only file reference">📁 {e.local_path}</span>}</> },
            { key: 't', label: 'Tags', render: (e: any) => <span className="small">{e.tags}</span> },
            { key: 'x', label: '', render: (e: any) => <button className="danger small" aria-label="Delete evidence" onClick={async () => { if (confirm('Delete this evidence record?')) { await api.del(`/api/evidence/${e.id}`); q.reload(); } }}>✕</button> },
          ]}
        />
      )}
    </div>
  );
}

function AddEvidence({ onDone, listingId }: { onDone: () => void; listingId: number | null }) {
  const toast = useToast();
  const blank = { kind: 'paid_ad', channel: '', market: 'us', advertiser: '', creator: '', hook: '', format: '', url: '', localPath: '', firstObserved: today(), lastObserved: '', tags: '', notes: '', isPublic: false, metricLabel: '', metricValue: '', metricScope: '' };
  const [f, setF] = useState<any>(blank);
  const [listing, setListing] = useState<any>(listingId ? { id: listingId, title: `Listing #${listingId}` } : null);
  const inp = (k: string, label: string, type = 'text', ph = '') => (
    <label className="f">{label}<input type={type} value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  const save = async () => {
    try {
      await api.post('/api/evidence', {
        kind: f.kind, listingId: listing?.id ?? null, channel: f.channel || null, market: f.market || null, advertiser: f.advertiser || null, creator: f.creator || null, hook: f.hook || null,
        format: f.format || null, url: f.url || null, localPath: f.localPath || null, firstObserved: f.firstObserved || null, lastObserved: f.lastObserved || null, tags: f.tags || null, notes: f.notes || null,
        isPublic: f.isPublic, metrics: f.metricLabel ? [{ label: f.metricLabel, value: f.metricValue, scope: f.metricScope }] : [],
      });
      toast('Evidence saved');
      setF(blank);
      onDone();
    } catch (e: any) {
      toast(e.message);
    }
  };
  return (
    <details className="card" open={!!listingId}>
      <summary>+ Add evidence manually</summary>
      <div className="formgrid" style={{ marginTop: 8 }}>
        <label className="f">Type<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="f">App{listing ? <span className="row">{listing.title} <button className="small" onClick={() => setListing(null)}>change</button></span> : <ListingPicker onPick={setListing} />}</label>
        {inp('channel', 'Channel', 'text', 'meta, tiktok, google, youtube…')}
        {inp('market', 'Market', 'text', 'us')}
        {inp('advertiser', 'Advertiser (as displayed)')}
        {inp('creator', 'Creator / account')}
        {inp('hook', 'Creative hook')}
        {inp('format', 'Format', 'text', 'video 9:16, carousel…')}
        {inp('url', 'Reference URL', 'url', 'https://')}
        {inp('localPath', 'Local-only file reference', 'text', 'screenshots/ad1.png')}
        {inp('firstObserved', 'First observed', 'date')}
        {inp('lastObserved', 'Last observed', 'date')}
        {inp('metricLabel', 'Displayed metric label', 'text', 'e.g. Impressions (range)')}
        {inp('metricValue', 'Displayed value', 'text', '10K–50K')}
        {inp('metricScope', 'Metric scope', 'text', 'US, last 30 days')}
        {inp('tags', 'Tags', 'text', 'ugc, discount')}
      </div>
      <label className="f" style={{ marginTop: 8 }}>Notes<textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} style={{ fontFamily: 'inherit' }} /></label>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="row small"><input type="checkbox" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} /> Include reference in public export (link only)</label>
        <span className="spacer" />
        <button className="primary" onClick={save}>Save evidence</button>
      </div>
      <p className="small muted">Paid ad = shown as an ad by the platform's own transparency tool. Organic = a normal post. Sponsorship (unverified) = looks promotional but no disclosure was confirmed.</p>
    </details>
  );
}

function Onboarding({ sp }: any) {
  const toast = useToast();
  const listingId = sp.get('listingId') ? Number(sp.get('listingId')) : null;
  const q = useAsync(() => api.get<any[]>(`/api/teardowns${qs({ listingId })}`), [listingId]);
  const blank = { versionLabel: '', observedAt: today(), market: 'us', device: '', firstMeaningfulAction: '', stepsToValue: '', signupFriction: '', paywallTiming: '', permissions: '', pricing: '', trialTerms: '', evidenceUrl: '', localPath: '', notes: '' };
  const [f, setF] = useState<any>(blank);
  const [listing, setListing] = useState<any>(listingId ? { id: listingId, title: `Listing #${listingId}` } : null);
  const fld = (k: string, label: string, type = 'text', ph = '') => <label className="f">{label}<input type={type} value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  const save = async () => {
    try {
      const body: any = { listingId: listing.id };
      for (const [k, v] of Object.entries(f)) body[k] = v === '' ? null : v;
      body.observedAt = f.observedAt;
      body.stepsToValue = f.stepsToValue === '' ? null : Number(f.stepsToValue);
      await api.post('/api/teardowns', body);
      toast('Teardown saved');
      setF(blank);
      q.reload();
    } catch (e: any) {
      toast(e.message);
    }
  };
  return (
    <div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Structured teardown</h2>
        <p className="small muted">Record what you observed in the app. Multiple versions per app are kept side by side. Conversion rates are not available and are not asked for.</p>
        <div className="formgrid">
          <label className="f">App{listing ? <span className="row">{listing.title} <button className="small" onClick={() => setListing(null)}>change</button></span> : <ListingPicker onPick={setListing} />}</label>
          {fld('versionLabel', 'App version / label', 'text', 'v2.4')}
          {fld('observedAt', 'Observed on', 'date')}
          {fld('market', 'Market', 'text', 'us')}
          {fld('device', 'Device', 'text', 'iPhone 15, Pixel 8')}
          {fld('firstMeaningfulAction', 'First meaningful action')}
          {fld('stepsToValue', 'Screens to first value', 'number')}
          {fld('signupFriction', 'Sign-up friction', 'text', 'forced email, SSO, skippable…')}
          {fld('paywallTiming', 'Paywall timing', 'text', 'before/after first value, soft/hard')}
          {fld('permissions', 'Permission prompts', 'text', 'notifications at step 3…')}
          {fld('pricing', 'Pricing shown', 'text', '$9.99/mo, $59.99/yr')}
          {fld('trialTerms', 'Trial terms', 'text', '7-day free trial, annual only')}
          {fld('evidenceUrl', 'Evidence link', 'url', 'https://')}
          {fld('localPath', 'Local-only screenshots folder')}
        </div>
        <label className="f" style={{ marginTop: 8 }}>Notes<textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} style={{ fontFamily: 'inherit' }} /></label>
        <button className="primary" disabled={!listing} onClick={save} style={{ marginTop: 8 }}>Save teardown</button>
      </div>
      <h2>Teardowns</h2>
      {!q.data?.length ? <State title="No teardowns yet" /> : (
        <DataTable
          rows={q.data}
          rowKey={(t: any) => t.id}
          cols={[
            { key: 'a', label: 'App', render: (t: any) => <Link to={`/listing/${t.listing_id}`}>{t.title}</Link>, sort: (t: any) => t.title },
            { key: 'v', label: 'Version · date', render: (t: any) => `${t.version_label ?? '—'} · ${t.observed_at}`, sort: (t: any) => t.observed_at },
            { key: 'f', label: 'First action (screens)', render: (t: any) => `${t.first_meaningful_action ?? '—'}${t.steps_to_value != null ? ` (${t.steps_to_value})` : ''}` },
            { key: 's', label: 'Sign-up', render: (t: any) => t.signup_friction ?? '—' },
            { key: 'p', label: 'Paywall', render: (t: any) => t.paywall_timing ?? '—' },
            { key: 'pr', label: 'Pricing · trial', render: (t: any) => `${t.pricing ?? '—'} · ${t.trial_terms ?? '—'}` },
            { key: 'pe', label: 'Permissions', render: (t: any) => t.permissions ?? '—' },
            { key: 'x', label: '', render: (t: any) => <button className="danger small" aria-label="Delete teardown" onClick={async () => { if (confirm('Delete this teardown?')) { await api.del(`/api/teardowns/${t.id}`); q.reload(); } }}>✕</button> },
          ]}
        />
      )}
    </div>
  );
}

function Libraries() {
  const [term, setTerm] = useState('');
  const [market, setMarket] = useState('us');
  const [custom, setCustom] = useState<{ label: string; url: string }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('radar.customLinks') ?? '[]');
    } catch {
      return [];
    }
  });
  const [nl, setNl] = useState({ label: '', url: '' });
  const saveCustom = (v: typeof custom) => {
    setCustom(v);
    try {
      localStorage.setItem('radar.customLinks', JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };
  return (
    <div>
      <div className="filters">
        <label className="f">Advertiser / app / keyword<input type="search" value={term} onChange={(e) => setTerm(e.target.value)} /></label>
        <label className="f">Country<input type="text" value={market} maxLength={2} onChange={(e) => setMarket(e.target.value.toLowerCase())} style={{ width: 60 }} /></label>
      </div>
      <p className="small muted">These open the official transparency tools in your browser. App Market Radar does not fetch or scrape them. Record what you find as evidence.</p>
      <div className="grid cols-3">
        {adLibraryLinks(term || '', market || 'us').map((l) => (
          <div className="card" key={l.label}>
            <strong>{l.label}</strong>
            <p className="small muted">{l.note}</p>
            <a className="btn" href={l.url} target="_blank" rel="noreferrer noopener">Open ↗</a>
          </div>
        ))}
      </div>
      <h2>Your publisher &amp; creator links</h2>
      <p className="small muted">Stored in this browser only (localStorage).</p>
      <ul>
        {custom.map((c, i) => (
          <li key={i}><a href={c.url} target="_blank" rel="noreferrer noopener">{c.label} ↗</a> <button className="small" onClick={() => saveCustom(custom.filter((_, j) => j !== i))}>remove</button></li>
        ))}
      </ul>
      <div className="row">
        <input type="text" placeholder="Label" value={nl.label} onChange={(e) => setNl({ ...nl, label: e.target.value })} />
        <input type="url" placeholder="https://…" value={nl.url} onChange={(e) => setNl({ ...nl, url: e.target.value })} />
        <button disabled={!nl.label || !/^https?:\/\//.test(nl.url)} onClick={() => { saveCustom([...custom, nl]); setNl({ label: '', url: '' }); }}>Add link</button>
      </div>
    </div>
  );
}
