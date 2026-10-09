import { useEffect, useState } from 'react';
import type { PageMeta } from './api';

export function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function Pager({ meta, onPage }: { meta: PageMeta; onPage: (p: number) => void }) {
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);
  return (
    <div className="pager">
      <span>{from}–{to} of {meta.total}</span>
      <div className="btns">
        <button className="btn ghost" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>← Prev</button>
        <span style={{ alignSelf: 'center' }}>Page {meta.page} / {meta.totalPages}</span>
        <button className="btn ghost" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>Next →</button>
      </div>
    </div>
  );
}

export function timeAgo(iso: string | null) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
