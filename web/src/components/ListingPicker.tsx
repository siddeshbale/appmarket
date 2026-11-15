import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api';

/** Search the local catalog and pick listings. */
export function ListingPicker({ onPick, exclude = [], placeholder = 'Search tracked/catalog apps…', platform }: { onPick: (l: any) => void; exclude?: number[]; placeholder?: string; platform?: string }) {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    if (term.trim().length < 2) {
      setRows([]);
      return;
    }
    const t = setTimeout(() => {
      api.get(`/api/catalog${qs({ q: term, platform, pageSize: 12, sort: 'title', dir: 'asc' })}`).then((d: any) => setRows(d.rows), () => setRows([]));
    }, 200);
    return () => clearTimeout(t);
  }, [term, platform]);
  return (
    <div style={{ position: 'relative', minWidth: 300 }}>
      <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={placeholder} aria-label={placeholder} style={{ width: '100%' }} />
      {rows.length > 0 && (
        <ul role="listbox" style={{ position: 'absolute', zIndex: 5, listStyle: 'none', margin: 0, padding: 4, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, width: '100%', maxHeight: 300, overflow: 'auto' }}>
          {rows
            .filter((r) => !exclude.includes(r.id))
            .map((r) => (
              <li key={r.id}>
                <button
                  style={{ width: '100%', justifyContent: 'flex-start', border: 'none' }}
                  onClick={() => {
                    onPick(r);
                    setTerm('');
                    setRows([]);
                  }}
                >
                  {r.title} <span className="small muted">· {r.platform === 'ios' ? 'iOS' : 'Android'} · {r.publisher_name ?? r.store_id}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
