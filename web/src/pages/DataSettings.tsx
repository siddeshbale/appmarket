import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, LocalOnly, ProvBadge, State, useAsync, useToast } from '../components/ui';
import { api, PUBLIC_MODE } from '../lib/api';
import { scopeLabel } from '../lib/format';
import { useMeta } from '../lib/meta';

const TABS = [
  ['coverage', 'Coverage'],
  ['runs', 'Ingestion'],
  ['sources', 'Sources'],
  ['markets', 'Markets'],
  ['taxonomy', 'Taxonomy'],
  ['import', 'Import'],
  ['links', 'Cross-store links'],
  ['export', 'Export & backups'],
];

export default function DataSettings() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'coverage';
  return (
    <div>
      <h1>Data &amp; settings</h1>
      <div className="tabs" role="tablist">
        {TABS.filter(([k]) => !PUBLIC_MODE || k === 'coverage' || k === 'sources').map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setSp({ tab: k })}>{l}</button>
        ))}
      </div>
      {tab === 'coverage' && <Coverage />}
      {tab === 'runs' && <Runs />}
      {tab === 'sources' && <Sources />}
      {tab === 'markets' && <Markets />}
      {tab === 'taxonomy' && <Taxonomy />}
      {tab === 'import' && <Import initialKind={sp.get('kind') ?? 'listings'} />}
      {tab === 'links' && <Links />}
      {tab === 'export' && <ExportTab />}
    </div>
  );
}

function Coverage() {
  const q = useAsync(() => api.get('/api/coverage'), []);
  const d: any = q.data;
  if (!d) return <State kind={q.error ? 'error' : 'loading'}>{q.error?.message}</State>;
  return (
    <div>
      <div className="grid cols-3">
        {Object.entries(d.counts ?? {}).map(([k, v]) => (
          <div className="card" key={k}><div className="small muted">{k}</div><div className="stat">{String(v)}</div></div>
        ))}
      </div>
      <h2>Provider status</h2>
      {d.providerStatus.length ? (
        <DataTable
          rows={d.providerStatus}
          rowKey={(r: any) => r.provider}
          cols={[
            { key: 'p', label: 'Provider', render: (r: any) => <code>{r.provider}</code> },
            { key: 's', label: 'Last run status', render: (r: any) => <span className={`badge ${r.last_status === 'success' ? 'ok' : r.last_status === 'partial' || r.last_status === 'skipped' ? 'warn' : 'bad'}`}>{r.last_status}</span> },
            { key: 'ls', label: 'Last successful refresh', render: (r: any) => (r.last_success ? r.last_success.slice(0, 16).replace('T', ' ') + ' UTC' : 'never') },
            { key: 'st', label: 'Freshness', render: (r: any) => (r.stale ? <span className="badge warn">stale (&gt;36h)</span> : <span className="badge ok">fresh</span>) },
            { key: 'm', label: 'Last message', render: (r: any) => <span className="small">{r.last_message ?? ''}</span> },
          ]}
        />
      ) : (
        <State title="No ingestion runs yet" />
      )}
      <h2>Chart coverage (store × market × device × chart × category)</h2>
      {d.scopes.length ? (
        <DataTable
          rows={d.scopes}
          rowKey={(s: any) => s.id}
          cols={[
            { key: 's', label: 'Scope', render: (s: any) => <Link to={`/?scope=${encodeURIComponent(s.id)}`}>{scopeLabel(s)}</Link>, sort: (s: any) => scopeLabel(s) },
            { key: 'src', label: 'Source', render: (s: any) => <><code className="small">{s.provider}</code> <ProvBadge p={s.provenance} /></> },
            { key: 'd', label: 'Days ok / attempted', num: true, render: (s: any) => `${s.okDays} / ${s.days}`, sort: (s: any) => s.okDays },
            { key: 'r', label: 'Date range', render: (s: any) => `${s.firstDay} → ${s.lastDay}` },
            { key: 'dep', label: 'Observed depth (last / max)', num: true, render: (s: any) => `${s.lastDepth} / ${s.maxDepth}` },
            { key: 'st', label: 'Last status', render: (s: any) => <span className={`badge ${s.lastStatus === 'complete' ? 'ok' : s.lastStatus === 'partial' ? 'warn' : 'bad'}`}>{s.lastStatus}{s.lastError ? ` · ${s.lastError}` : ''}</span> },
          ]}
        />
      ) : (
        <State title="No chart snapshots yet" />
      )}
      {d.obsCoverage?.length > 0 && (
        <>
          <h2>Metadata observation coverage</h2>
          <DataTable
            rows={d.obsCoverage}
            rowKey={(r: any) => r.provider + r.provenance + r.market}
            cols={[
              { key: 'p', label: 'Provider', render: (r: any) => <><code>{r.provider}</code> <ProvBadge p={r.provenance} /></> },
              { key: 'm', label: 'Market', render: (r: any) => r.market.toUpperCase() },
              { key: 'l', label: 'Listings', num: true, render: (r: any) => r.listings },
              { key: 'o', label: 'Observations', num: true, render: (r: any) => r.observations },
              { key: 'u', label: 'Unavailable in storefront', num: true, render: (r: any) => r.unavailable },
              { key: 'r', label: 'Range', render: (r: any) => `${r.first_day} → ${r.last_day}` },
            ]}
          />
        </>
      )}
    </div>
  );
}

function Runs() {
  const meta = useMeta();
  const toast = useToast();
  const runs = useAsync(() => api.get<any[]>('/api/runs'), []);
  const [preview, setPreview] = useState<any>(null);
  const [log, setLog] = useState<any>(null);
  const [markets, setMarkets] = useState('');
  const body = () => ({ markets: markets ? markets.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : undefined });
  const dry = async () => {
    try {
      setPreview(await api.post('/api/ingest', { ...body(), dryRun: true }));
    } catch (e: any) {
      toast(e.message);
    }
  };
  const start = async () => {
    try {
      await api.post('/api/ingest', body());
      toast('Ingestion started — refresh runs in a minute');
      setTimeout(runs.reload, 4000);
    } catch (e: any) {
      toast(e.message);
    }
  };
  return (
    <div>
      <LocalOnly feature="Ingestion" />
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Run collection now</h2>
        {meta?.mode === 'demo' ? (
          <p className="banner demo">Disabled in demo mode. Start the app in live mode (<code>npm start</code>) to collect real data.</p>
        ) : (
          <>
            <p className="small muted">
              Uses configured markets ({meta?.config?.ingestMarkets?.join(', ')}), depth {meta?.config?.chartDepth}, and per-provider request budgets. Same as <code>npm run ingest</code>. Scheduling is not configured automatically — see docs/SCHEDULING.md.
            </p>
            <div className="row">
              <label className="f">Markets override<input type="text" value={markets} placeholder="us,in" onChange={(e) => setMarkets(e.target.value)} /></label>
              <button onClick={dry}>Dry run (preview scope)</button>
              <button className="primary" onClick={start} disabled={meta?.ingestRunning}>Run ingestion</button>
              <button onClick={runs.reload}>Refresh</button>
            </div>
          </>
        )}
        {preview && (
          <div style={{ marginTop: 10 }}>
            <strong>Dry run — nothing fetched or written.</strong> Markets: {preview.markets.join(', ') || 'none'}{preview.skippedMarkets.length ? ` (skipped, not enabled: ${preview.skippedMarkets.join(', ')})` : ''}
            {preview.providers.map((p: any) => (
              <details key={p.provider}>
                <summary>{p.provider}: {p.planned.length} planned request(s)</summary>
                <pre className="pre">{p.planned.join('\n') || '(none)'}</pre>
              </details>
            ))}
          </div>
        )}
      </div>
      <h2>Recent runs</h2>
      {!runs.data?.length ? <State title="No runs yet" /> : (
        <DataTable
          rows={runs.data}
          rowKey={(r: any) => r.id}
          cols={[
            { key: 'i', label: '#', num: true, render: (r: any) => r.id, sort: (r: any) => r.id },
            { key: 'p', label: 'Provider', render: (r: any) => <code>{r.provider}</code> },
            { key: 's', label: 'Status', render: (r: any) => <span className={`badge ${r.status === 'success' ? 'ok' : r.status === 'partial' || r.status === 'skipped' || r.status === 'running' ? 'warn' : 'bad'}`}>{r.status}</span> },
            { key: 't', label: 'Started (UTC)', render: (r: any) => r.started_at.slice(0, 19).replace('T', ' ') },
            { key: 'n', label: 'Requests / items', num: true, render: (r: any) => `${r.requests} / ${r.items}` },
            { key: 'e', label: 'Error', render: (r: any) => <span className="small">{r.error_class ? <code>{r.error_class}</code> : ''} {r.message}</span> },
            { key: 'l', label: '', render: (r: any) => <button className="small" onClick={async () => setLog(await api.get(`/api/runs/${r.id}`))}>Log</button> },
          ]}
        />
      )}
      {log && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="row"><strong>Run #{log.id} log</strong><span className="spacer" /><button onClick={() => setLog(null)}>Close</button></div>
          <pre className="pre">{log.log || '(empty)'}</pre>
        </div>
      )}
    </div>
  );
}

function Sources() {
  const meta = useMeta();
  return (
    <div>
      <p className="small muted">Source manifest: documentation, accessible fields, intended use, rate policy, what may appear in the public export, and the latest live validation recorded by <code>npm run smoke:live</code>.</p>
      {(meta?.providers ?? []).map((p: any) => (
        <div className="card" key={p.id}>
          <div className="row">
            <h3 style={{ margin: 0 }}>{p.name}</h3>
            <span className={`badge ${p.status === 'enabled' ? 'ok' : p.status === 'optional' ? 'warn' : 'bad'}`}>{p.status}</span>
            <code className="small">{p.id}</code>
            <span className="spacer" />
            {p.docsUrl && <a href={p.docsUrl} target="_blank" rel="noreferrer noopener">docs ↗</a>}
            {p.termsUrl && <a href={p.termsUrl} target="_blank" rel="noreferrer noopener">terms ↗</a>}
          </div>
          <p className="small">{p.intendedUse}</p>
          {p.capabilities && (
            <dl className="kv small">
              {p.capabilities.charts && <><dt>Charts</dt><dd>{p.capabilities.charts.chartTypes.join(', ')} · devices {p.capabilities.charts.devices.join(', ')} · category charts {p.capabilities.charts.categoryCharts ? 'yes' : 'no'} · max depth {p.capabilities.charts.maxDepth}</dd></>}
              <dt>Fields</dt><dd>{p.capabilities.fields.join(', ')}</dd>
              <dt>Rate policy</dt><dd>{p.rateLimit}</dd>
              <dt>Public export</dt><dd>{p.publicExportFields.join(', ') || 'nothing'}</dd>
            </dl>
          )}
          <ul className="small">{p.limitations.map((x: string) => <li key={x}>{x}</li>)}</ul>
          {p.validation ? (
            <details>
              <summary className="small">Live validation results</summary>
              <table className="data small">
                <tbody>
                  {Object.entries(p.validation).map(([k, v]: any) => (
                    <tr key={k}><td><code>{k}</code></td><td>{v.ok ? <span className="badge ok">pass</span> : <span className="badge bad">fail</span>}</td><td>{v.detail}</td><td>{v.at?.slice(0, 16)}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : (
            !PUBLIC_MODE && <p className="small muted">Not yet validated live in this database. Run <code>npm run smoke:live</code>.</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Markets() {
  const toast = useToast();
  const q = useAsync(() => api.get<any[]>('/api/markets'), []);
  const [n, setN] = useState({ code: '', name: '' });
  return (
    <div>
      <p className="small muted">Ingestion runs only for markets that are enabled here <em>and</em> listed in INGEST_MARKETS (or passed with --markets). Enable a new market only after <code>npm run smoke:live -- --markets xx</code> passes.</p>
      <DataTable
        rows={q.data ?? []}
        rowKey={(m: any) => m.code}
        cols={[
          { key: 'c', label: 'Code', render: (m: any) => <code>{m.code}</code> },
          { key: 'n', label: 'Name', render: (m: any) => m.name },
          { key: 'l', label: 'Language', render: (m: any) => m.default_language },
          { key: 'e', label: 'Enabled', render: (m: any) => <input type="checkbox" aria-label={`Enable ${m.code}`} checked={!!m.enabled} onChange={async (e) => { await api.patch(`/api/markets/${m.code}`, { enabled: e.target.checked }); q.reload(); toast(`${m.code.toUpperCase()} ${e.target.checked ? 'enabled' : 'disabled'}`); }} /> },
          { key: 'no', label: 'Notes', render: (m: any) => <span className="small">{m.notes}</span> },
        ]}
      />
      <div className="row" style={{ marginTop: 10 }}>
        <input type="text" placeholder="code (e.g. de)" maxLength={2} value={n.code} onChange={(e) => setN({ ...n, code: e.target.value.toLowerCase() })} style={{ width: 120 }} />
        <input type="text" placeholder="Name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} />
        <button disabled={!/^[a-z]{2}$/.test(n.code) || !n.name} onClick={async () => { await api.post('/api/markets', n); setN({ code: '', name: '' }); q.reload(); }}>Add market (disabled)</button>
      </div>
    </div>
  );
}

function Taxonomy() {
  const toast = useToast();
  const q = useAsync(() => api.get('/api/taxonomy'), []);
  const [plat, setPlat] = useState('');
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [nu, setNu] = useState({ slug: '', name: '', isGame: false });
  const d: any = q.data;
  if (!d) return <State kind="loading" />;
  const rows = d.categories.filter((c: any) => (!plat || c.platform === plat) && (!onlyUnmapped || !c.unified_slug));
  return (
    <div>
      <p className="small muted">Original store categories (left) are never renamed. Map each to one unified category for cross-store filtering. Many store categories can map to one unified category.</p>
      <div className="filters">
        <label className="f">Store<select value={plat} onChange={(e) => setPlat(e.target.value)}><option value="">Both</option><option value="ios">App Store</option><option value="android">Google Play</option></select></label>
        <label className="row small"><input type="checkbox" checked={onlyUnmapped} onChange={(e) => setOnlyUnmapped(e.target.checked)} /> Unmapped only ({d.categories.filter((c: any) => !c.unified_slug).length})</label>
        <span className="spacer" />
        <input type="text" placeholder="new_slug" value={nu.slug} onChange={(e) => setNu({ ...nu, slug: e.target.value })} style={{ width: 120 }} />
        <input type="text" placeholder="Unified name" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
        <label className="row small"><input type="checkbox" checked={nu.isGame} onChange={(e) => setNu({ ...nu, isGame: e.target.checked })} /> games</label>
        <button disabled={!/^[a-z0-9_]{2,40}$/.test(nu.slug) || !nu.name} onClick={async () => { await api.post('/api/unified', nu); setNu({ slug: '', name: '', isGame: false }); q.reload(); }}>Add unified category</button>
      </div>
      <DataTable
        rows={rows}
        rowKey={(c: any) => c.id}
        cols={[
          { key: 'p', label: 'Store', render: (c: any) => (c.platform === 'ios' ? 'App Store' : 'Google Play'), sort: (c: any) => c.platform },
          { key: 'id', label: 'Store category id', render: (c: any) => <code>{c.store_category_id}</code>, sort: (c: any) => c.store_category_id },
          { key: 'n', label: 'Store category name', render: (c: any) => c.name, sort: (c: any) => c.name },
          { key: 'l', label: 'Listings', num: true, render: (c: any) => c.listings, sort: (c: any) => c.listings },
          {
            key: 'u', label: 'Unified category', render: (c: any) => (
              <select value={c.unified_slug ?? ''} aria-label={`Unified category for ${c.name}`} onChange={async (e) => { await api.patch(`/api/categories/${c.id}`, { unifiedSlug: e.target.value || null }); toast('Mapping saved'); q.reload(); }}>
                <option value="">— unmapped —</option>
                {d.unified.map((u: any) => <option key={u.slug} value={u.slug}>{u.name}</option>)}
              </select>
            ),
          },
        ]}
      />
    </div>
  );
}

function Import({ initialKind }: { initialKind: string }) {
  const toast = useToast();
  const kinds = useAsync(() => api.get('/api/imports/kinds'), []);
  const history = useAsync(() => api.get<any[]>('/api/imports'), []);
  const [kind, setKind] = useState(initialKind);
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [preset, setPreset] = useState('');
  const [presetPlatform, setPresetPlatform] = useState<'ios' | 'android'>('ios');
  const [presetStoreId, setPresetStoreId] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const k: any = kinds.data;
  const spec = k?.kinds.find((x: any) => x.kind === kind);
  const payload = () => ({ kind, format, content, filename, sourceLabel: sourceLabel || null, preset: kind === 'first_party' && preset ? preset : undefined, platform: preset ? presetPlatform : undefined, storeId: preset && presetStoreId ? presetStoreId : undefined });
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (k && f.size > k.maxBytes) return toast(`File too large (max ${k.maxBytes} bytes)`);
    setFilename(f.name);
    setFormat(f.name.toLowerCase().endsWith('.json') ? 'json' : 'csv');
    setContent(await f.text());
    setPreview(null);
  };
  const doPreview = async () => {
    try {
      setPreview(await api.post('/api/imports/preview', payload()));
    } catch (e: any) {
      toast(e.message);
    }
  };
  const commit = async () => {
    try {
      const r = await api.post('/api/imports/commit', payload());
      toast(`Imported ${r.written} row(s) as import #${r.importId}`);
      setPreview(null);
      setContent('');
      history.reload();
    } catch (e: any) {
      toast(e.message);
    }
  };
  if (!k) return <State kind="loading" />;
  return (
    <div>
      <p className="small muted">Imported rows are labeled User-supplied, kept separate from direct observations, and flagged with the import id. Max {(k.maxBytes / 1e6).toFixed(1)} MB per file. Templates with sample rows are in <code>samples/imports/</code>.</p>
      <div className="filters">
        <label className="f">Template<select value={kind} onChange={(e) => { setKind(e.target.value); setPreview(null); }}>{k.kinds.map((x: any) => <option key={x.kind} value={x.kind}>{x.title}</option>)}</select></label>
        <label className="f">File (CSV or JSON)<input type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        <label className="f">Format<select value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'json')}><option value="csv">CSV</option><option value="json">JSON</option></select></label>
        <label className="f">Source label<input type="text" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="where this came from" /></label>
        {kind === 'first_party' && (
          <>
            <label className="f">Mapping<select value={preset} onChange={(e) => setPreset(e.target.value)}><option value="">Canonical (long) format</option>{Object.entries(k.presets).map(([pk, pv]: any) => <option key={pk} value={pk}>{pv.title}</option>)}</select></label>
            {preset === 'app_store_connect_analytics' && (
              <>
                <label className="f">Platform<select value={presetPlatform} onChange={(e) => setPresetPlatform(e.target.value as 'ios' | 'android')}><option value="ios">ios</option></select></label>
                <label className="f">Apple app id<input type="text" value={presetStoreId} onChange={(e) => setPresetStoreId(e.target.value)} /></label>
              </>
            )}
          </>
        )}
      </div>
      {spec && (
        <details className="card">
          <summary>{spec.title} — columns {spec.private && <span className="badge user">private, never exported publicly</span>}</summary>
          <p className="small">{spec.description}</p>
          <table className="data small">
            <thead><tr><th>Column</th><th>Type</th><th>Required</th><th>Unit / notes</th></tr></thead>
            <tbody>{spec.fields.map((f: any) => <tr key={f.key}><td><code>{f.key}</code>{f.aliases?.length ? <span className="muted"> (also: {f.aliases.join(', ')})</span> : null}</td><td>{f.type}{f.enum ? `: ${f.enum.join(' | ')}` : ''}</td><td>{f.required ? 'yes' : ''}</td><td>{[f.unit, f.description].filter(Boolean).join(' — ')}</td></tr>)}</tbody>
          </table>
          {kind === 'first_party' && preset && <p className="small muted">{k.presets[preset].note}</p>}
        </details>
      )}
      <label className="f" style={{ marginTop: 10 }}>…or paste content<textarea value={content} onChange={(e) => { setContent(e.target.value); setPreview(null); }} placeholder={spec ? spec.fields.map((f: any) => f.key).join(',') : ''} /></label>
      <div className="row" style={{ marginTop: 8 }}>
        <button disabled={!content} onClick={doPreview}>Preview</button>
        <button className="primary" disabled={!preview || preview.totals.ok === 0 || preview.missingColumns.length > 0} onClick={commit}>Import {preview ? preview.totals.ok : ''} valid row(s)</button>
      </div>
      {preview && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="row">
            <span className="badge">total {preview.totals.total}</span>
            <span className="badge ok">valid {preview.totals.ok}</span>
            <span className="badge bad">bad {preview.totals.bad}</span>
            <span className="badge warn">duplicates {preview.totals.duplicate}</span>
          </div>
          {preview.missingColumns.length > 0 && <div className="banner bad" style={{ marginTop: 8 }}>Missing required columns: {preview.missingColumns.join(', ')}</div>}
          {preview.unknownColumns.length > 0 && <div className="banner warn" style={{ marginTop: 8 }}>Ignored unknown columns: {preview.unknownColumns.join(', ')}</div>}
          <div className="table-wrap" style={{ marginTop: 8, maxHeight: 380 }}>
            <table className="data small">
              <thead><tr><th>Row</th><th>Status</th>{preview.fields.map((f: any) => <th key={f.key}>{f.key}<div className="muted">{f.type}{f.unit ? ` · ${f.unit}` : ''}</div></th>)}</tr></thead>
              <tbody>
                {preview.rows.map((r: any) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.issues.length ? <span className="badge bad" title={r.issues.map((i: any) => `${i.field}: ${i.message}`).join('; ')}>{r.issues.map((i: any) => `${i.field}: ${i.message}`).join('; ')}</span> : r.duplicate ? <span className="badge warn">{r.duplicate}</span> : <span className="badge ok">ok</span>}</td>
                    {preview.fields.map((f: any) => <td key={f.key}>{r.values[f.key] === null || r.values[f.key] === undefined ? <span className="muted">—</span> : String(r.values[f.key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.previewTruncated && <p className="small muted">Showing the first 200 rows; totals cover the whole file.</p>}
        </div>
      )}
      <h2>Import history</h2>
      {!history.data?.length ? <State title="No imports yet" /> : (
        <DataTable
          rows={history.data}
          rowKey={(r: any) => r.id}
          cols={[
            { key: 'i', label: '#', num: true, render: (r: any) => r.id },
            { key: 'k', label: 'Kind', render: (r: any) => r.kind },
            { key: 'f', label: 'File / source', render: (r: any) => `${r.filename ?? '—'} ${r.source_label ? `· ${r.source_label}` : ''}` },
            { key: 'd', label: 'Imported', render: (r: any) => r.created_at.slice(0, 16).replace('T', ' ') },
            { key: 'n', label: 'ok / bad / dup / total', render: (r: any) => `${r.rows_ok} / ${r.rows_bad} / ${r.rows_duplicate} / ${r.rows_total}` },
            { key: 'p', label: 'Private', render: (r: any) => (r.is_private ? 'yes' : 'no') },
            { key: 'x', label: '', render: (r: any) => <button className="danger small" onClick={async () => { if (confirm(`Delete import #${r.id} and every row it created? Observed data is not affected.`)) { await api.del(`/api/imports/${r.id}`); history.reload(); } }}>Delete</button> },
          ]}
        />
      )}
    </div>
  );
}

function Links() {
  const toast = useToast();
  const [status, setStatus] = useState('suggested');
  const q = useAsync(() => api.get<any[]>(`/api/links?status=${status}`), [status]);
  return (
    <div>
      <p className="small muted">Suggestions need a title match plus a matching publisher name or identifier prefix, and always need your review. Names alone never link listings.</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Link status"><option value="suggested">Suggested</option><option value="verified">Verified</option><option value="rejected">Rejected</option></select>
        <button onClick={async () => { const r = await api.post('/api/links/suggest'); toast(`${r.created} new suggestion(s), ${r.ambiguous} ambiguous`); q.reload(); }}>Find suggestions</button>
      </div>
      {!q.data?.length ? <State title={`No ${status} links`} /> : q.data.map((l: any) => (
        <div className="card" key={l.id}>
          <div className="row">
            <Link to={`/listing/${l.listing_a}`}>{l.a_title}</Link> <span className="small muted">({l.a_platform} {l.a_store_id})</span> ↔ <Link to={`/listing/${l.listing_b}`}>{l.b_title}</Link> <span className="small muted">({l.b_platform} {l.b_store_id})</span>
            <span className="spacer" />
            {l.status !== 'verified' && <button onClick={async () => { await api.post(`/api/links/${l.id}`, { status: 'verified' }); q.reload(); }}>Verify</button>}
            {l.status !== 'rejected' && <button onClick={async () => { await api.post(`/api/links/${l.id}`, { status: 'rejected' }); q.reload(); }}>Reject</button>}
          </div>
          <ul className="small">{l.evidence.map((e: any, i: number) => <li key={i}><span className="badge">{e.strength}</span> {e.detail}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

function ExportTab() {
  const toast = useToast();
  const meta = useMeta();
  const pv = useAsync(() => api.get('/api/public-preview'), []);
  return (
    <div className="grid cols-2">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Backups</h3>
        <p className="small">Writes a consistent copy of the {meta?.mode} database to <code>backups/</code> (keeps the newest 14). Same as <code>npm run backup</code>.</p>
        <button onClick={async () => { const r = await api.post('/api/backup'); toast(`Backup written: ${r.file}`); }}>Back up now</button>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Public static export</h3>
        <p className="small">Build a read-only site from a sanitized dataset:</p>
        <pre className="pre">npm run export:public{'\n'}npm run verify:public{'\n'}npm run preview:public</pre>
        {pv.data && (
          <p className="small">
            Would include (sample): {(pv.data as any).counts.listings}+ listings, {(pv.data as any).counts.scopes} chart scopes, {(pv.data as any).counts.publicEvidence} public evidence links.
            <br />
            Always excluded: {(pv.data as any).excluded.join(', ')}.
          </p>
        )}
        <p className="small muted">See docs/PUBLIC_EXPORT.md for free-tier static hosting notes and quotas. Nothing is deployed automatically.</p>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Limits &amp; settings</h3>
        <dl className="kv small">
          <dt>Mode</dt><dd>{meta?.mode}</dd>
          <dt>Bound to</dt><dd>{meta?.config?.host}:{meta?.config?.port}</dd>
          <dt>Ingest markets</dt><dd>{meta?.config?.ingestMarkets?.join(', ')}</dd>
          <dt>Chart depth</dt><dd>{meta?.config?.chartDepth}</dd>
          <dt>Apple charts</dt><dd>{meta?.config?.appleCharts?.map((c: any) => `${c.device}:${c.chartType}:${c.genre}`).join(', ')}</dd>
          <dt>Request budgets / run</dt><dd>{meta?.config?.budgets && Object.entries(meta.config.budgets).map(([k, v]) => `${k} ${v}`).join(' · ')}</dd>
          <dt>Google Play reader</dt><dd>{meta?.config?.googlePlayEnabled ? 'enabled' : 'disabled'}</dd>
          <dt>Alert threshold</dt><dd>{meta?.config?.alertRankThreshold} positions</dd>
          <dt>HTTP cache TTL</dt><dd>{meta?.config?.cacheTtlMin} min</dd>
          <dt>Import max size</dt><dd>{meta?.config?.importMaxBytes} bytes</dd>
        </dl>
        <p className="small muted">Change these in <code>.env</code> (see .env.example) and restart.</p>
      </div>
    </div>
  );
}
