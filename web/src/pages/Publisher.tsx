import { useParams } from 'react-router-dom';
import { AppCell, DataTable, Loadable, ProvBadge, useAsync } from '../components/ui';
import { api } from '../lib/api';
import { fmtDay, PLATFORM_LABEL } from '../lib/format';

export default function PublisherPage() {
  const { id } = useParams();
  const q = useAsync(() => api.get(`/api/publishers/${id}`), [id]);
  return (
    <Loadable q={q}>
      {(d: any) => (
        <div>
          <h1>{d.publisher.name}</h1>
          <p className="sub">
            {PLATFORM_LABEL[d.publisher.platform]} publisher · {d.listings.length} listing(s) in the local catalog {d.publisher.provenance && <ProvBadge p={d.publisher.provenance} />}
            {d.publisher.url && (
              <>
                {' '}
                · <a href={d.publisher.url} target="_blank" rel="noreferrer noopener">store developer page ↗</a>
              </>
            )}
          </p>
          <p className="small muted">The same company may appear as separate publishers on each store; publishers are never merged automatically.</p>
          <DataTable
            rows={d.listings}
            rowKey={(r: any) => r.id}
            initialSort={{ key: 'best', dir: 'asc' }}
            cols={[
              { key: 'a', label: 'App', render: (r: any) => <AppCell l={r} />, sort: (r: any) => r.title },
              { key: 'c', label: 'Store category', render: (r: any) => r.category_name ?? '—', sort: (r: any) => r.category_name },
              { key: 'best', label: 'Best observed rank (any scope)', num: true, render: (r: any) => (r.best_rank ? '#' + r.best_rank : '—'), sort: (r: any) => r.best_rank },
              { key: 'rel', label: 'Released', render: (r: any) => fmtDay(r.release_date), sort: (r: any) => r.release_date },
            ]}
          />
        </div>
      )}
    </Loadable>
  );
}
