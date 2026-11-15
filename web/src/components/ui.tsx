import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PUBLIC_MODE } from '../lib/api';
import { scopeLabel } from '../lib/format';

// ---------------- async data hook ----------------
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: Error | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error) => alive && setState({ data: undefined, error, loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...state, reload: useCallback(() => setN((x) => x + 1), []) };
}

// ---------------- toast ----------------
const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4500);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastCtx.Provider value={setMsg}>
      {children}
      {msg && (
        <div className="toast" role="status" aria-live="polite">
          {msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------- labels & states ----------------
export function ProvBadge({ p }: { p: string | null | undefined }) {
  if (p === 'demo') return <span className="badge demo" title="Fictional demo record">Demo · fictional</span>;
  if (p === 'imported') return <span className="badge user" title="Imported from a file you supplied">User-supplied · import</span>;
  if (p === 'user') return <span className="badge user" title="Entered manually">User-supplied · manual</span>;
  return <span className="badge observed" title="Fetched from a public store source">Observed</span>;
}
export const ModeledBadge = () => <span className="badge modeled" title="Output of your own scenario inputs — not a measurement">Modeled</span>;

export function State({ kind = 'empty', title, children }: { kind?: 'empty' | 'loading' | 'error' | 'restricted' | 'stale'; title?: string; children?: ReactNode }) {
  const t = title ?? { empty: 'Nothing here yet', loading: 'Loading…', error: 'Something went wrong', restricted: 'Source restricted', stale: 'Data is stale' }[kind];
  return (
    <div className="state" role={kind === 'error' ? 'alert' : 'status'}>
      <strong>{t}</strong>
      {children}
    </div>
  );
}
export function Loadable<T>({ q, children, empty }: { q: { data: T | undefined; error: Error | null; loading: boolean }; children: (d: T) => ReactNode; empty?: (d: T) => boolean }) {
  if (q.error) return <State kind="error">{q.error.message}</State>;
  if (q.loading && q.data === undefined) return <State kind="loading" />;
  if (q.data === undefined) return null;
  if (empty?.(q.data)) return <State kind="empty" />;
  return <>{children(q.data)}</>;
}

export function LocalOnly({ feature }: { feature: string }) {
  if (!PUBLIC_MODE) return null;
  return (
    <div className="banner public">
      <strong>{feature}</strong> is available when you run App Market Radar locally. This public build is read-only and contains no private data.
    </div>
  );
}

export function AppCell({ l, sub }: { l: any; sub?: ReactNode }) {
  if (!l) return <span className="muted">unknown listing</span>;
  const initials = String(l.title ?? '?').slice(0, 2).toUpperCase();
  return (
    <div className="app-cell">
      {l.icon_url ? <img src={l.icon_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="icon-ph" aria-hidden>{initials}</span>}
      <div>
        <Link className="t" to={`/listing/${l.id}`}>
          {l.title}
        </Link>
        <div className="p">
          {l.publisher_name ?? '—'} · {l.platform === 'ios' ? 'iOS' : 'Android'}
          {l.provenance === 'demo' ? ' · demo' : ''}
          {sub ? <> · {sub}</> : null}
        </div>
      </div>
    </div>
  );
}

export function Movement({ m }: { m: any }) {
  if (!m) return <span className="muted">—</span>;
  const title = m.explanation;
  switch (m.kind) {
    case 'up':
      return <span className="mv-up" title={title}>▲ {m.delta}</span>;
    case 'down':
      return <span className="mv-down" title={title}>▼ {Math.abs(m.delta)}</span>;
    case 'same':
      return <span className="muted" title={title}>＝</span>;
    case 'new_first_observed':
      return <span className="mv-new" title={title}>NEW</span>;
    case 'reentry':
      return <span className="mv-new" title={title}>RE-ENTRY</span>;
    default:
      return <span className="muted" title={title}>n/a</span>;
  }
}

// ---------------- sortable table ----------------
export interface Col<T> {
  key: string;
  label: ReactNode;
  render: (r: T) => ReactNode;
  sort?: (r: T) => number | string | null | undefined;
  num?: boolean;
  title?: string;
}
export function DataTable<T>({ rows, cols, initialSort, rowKey, caption }: { rows: T[]; cols: Col<T>[]; initialSort?: { key: string; dir: 'asc' | 'desc' }; rowKey: (r: T, i: number) => string | number; caption?: string }) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const c = cols.find((x) => x.key === sort.key);
    if (!c?.sort) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = c.sort!(a);
      const vb = c.sort!(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1; // blanks always last
      if (vb === null || vb === undefined) return -1;
      return va > vb ? dir : -dir;
    });
  }, [rows, cols, sort]);
  return (
    <div className="table-wrap">
      <table className="data">
        {caption && <caption className="skip">{caption}</caption>}
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.num ? 'num' : ''} title={c.title} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                {c.sort ? (
                  <button onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))}>
                    {c.label} {sort?.key === c.key ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey(r, i)}>
              {cols.map((c) => (
                <td key={c.key} className={c.num ? 'num' : ''}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- scope picker ----------------
export function ScopeSelect({ scopes, value, onChange, label = 'Chart scope' }: { scopes: any[]; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="f">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 560 }}>
        {scopes.map((s) => (
          <option key={s.id} value={s.id}>
            {scopeLabel(s)} {s.lastOkDay ? `(${s.okDays}d, last ${s.lastOkDay})` : '(no successful fetch)'}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------- charts (dependency-free SVG) ----------------
const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
export interface Series {
  name: string;
  points: { day: string; value: number | null; presence?: string }[];
}

/**
 * Line chart with explicit gaps (null breaks the line — no interpolation). For ranks, `invert` puts #1 at the top.
 * Absent/failed/no-data days are drawn as small markers below the plot so gaps are explained, not hidden.
 */
export function LineChart({ series, invert = false, height = 220, yLabel, days }: { series: Series[]; invert?: boolean; height?: number; yLabel?: string; days: string[] }) {
  const W = 760;
  const H = height;
  const pad = { l: 46, r: 12, t: 10, b: 38 };
  const vals = series.flatMap((s) => s.points.map((p) => p.value).filter((v): v is number => v !== null));
  if (!vals.length || !days.length) return <State kind="empty" title="No data points in this window">Gaps are never filled in.</State>;
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (invert) min = Math.max(1, Math.min(1, min));
  if (min === max) {
    const padV = invert ? 1 : Math.abs(min) * 0.05 || 1;
    max = max + padV;
    if (!invert) min = Math.max(0, min - padV);
  }
  const x = (i: number) => pad.l + (days.length === 1 ? 0 : (i / (days.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => {
    const t = (v - min) / (max - min);
    return invert ? pad.t + t * (H - pad.t - pad.b) : H - pad.b - t * (H - pad.t - pad.b);
  };
  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => min + ((max - min) * i) / ticks);
  const dayIdx = new Map(days.map((d, i) => [d, i]));
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));
  return (
    <div>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel ?? 'value'} over time${invert ? ', rank 1 at top' : ''}`}>
        <g className="grid">
          {tickVals.map((v, i) => (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
              <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">
                {invert ? '#' + Math.round(v) : Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v)}
              </text>
            </g>
          ))}
        </g>
        {days.map((d, i) =>
          i % labelEvery === 0 || i === days.length - 1 ? (
            <text key={d} x={x(i)} y={H - pad.b + 14} textAnchor="middle">
              {d.slice(5)}
            </text>
          ) : null,
        )}
        {series.map((s, si) => {
          const segs: string[] = [];
          let cur = '';
          for (const p of s.points) {
            const i = dayIdx.get(p.day);
            if (i === undefined) continue;
            if (p.value === null) {
              if (cur) segs.push(cur);
              cur = '';
              continue;
            }
            cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
          }
          if (cur) segs.push(cur);
          return (
            <g key={s.name}>
              {segs.map((d, k) => (
                <path key={k} d={d} fill="none" stroke={COLORS[si % COLORS.length]} strokeWidth={2} />
              ))}
              {s.points.map((p) => {
                const i = dayIdx.get(p.day);
                if (i === undefined) return null;
                if (p.value !== null)
                  return (
                    <circle key={p.day} cx={x(i)} cy={y(p.value)} r={2.6} fill={COLORS[si % COLORS.length]}>
                      <title>{`${s.name} · ${p.day}: ${invert ? '#' : ''}${p.value}`}</title>
                    </circle>
                  );
                if (!p.presence || p.presence === 'no_data') return null;
                const yy = H - pad.b + 24 + si * 4;
                return (
                  <rect key={p.day} x={x(i) - 2} y={yy} width={4} height={3} fill={p.presence === 'failed' ? 'var(--down)' : 'var(--muted)'}>
                    <title>{`${s.name} · ${p.day}: ${p.presence === 'absent' ? 'not in observed chart depth' : 'fetch failed'}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {series.map((s, i) => (
          <span key={s.name}>
            <i style={{ background: COLORS[i % COLORS.length] }} />
            {s.name}
          </span>
        ))}
        {invert && <span className="muted">Rank 1 at top · gaps = no comparable chart that day · grey ticks = outside observed depth · red ticks = fetch failed</span>}
      </div>
    </div>
  );
}
