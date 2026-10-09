import { useEffect, useState } from 'react';
import { api, type Order, type PageMeta } from './api';
import { Pager, useDebounced } from './ui';

const STATUS_STYLE: Record<string, string> = {
  accepted: 'success',
  rejected: 'danger',
  pending: 'warning',
  processing: 'warning',
};

export default function Orders() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<PageMeta>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const q = useDebounced(search);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .orders({ page, pageSize: 10, status, search: q })
      .then((r) => !cancelled && (setOrders(r.data), setMeta(r.meta), setError('')))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page, status, q]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Orders</h2>
          <p>{meta ? `${meta.total} orders placed through the assistant` : 'Customer orders'}</p>
        </div>
      </header>

      <div className="toolbar">
        <input id="order-search" className="field search" placeholder="Search by order # or customer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select id="filter-status" className="field" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Placed</th></tr>
            </thead>
            <tbody>
              {loading && orders.length === 0
                ? Array.from({ length: 5 }, (_, i) => (
                    <tr key={i}>{Array.from({ length: 6 }, (_, j) => <td key={j}><div className="skeleton" /></td>)}</tr>
                  ))
                : orders.map((o) => (
                    <tr key={o.id}>
                      <td className="strong">#{o.orderNumber}</td>
                      <td>
                        {o.customer.name ?? '—'}
                        <div className="cell-sub">{o.customer.phone ?? o.customer.email}</div>
                        {o.customer.shippingAddress && <div className="cell-sub">{o.customer.shippingAddress}</div>}
                      </td>
                      <td style={{ maxWidth: 280 }}>{o.itemsSummary || '—'}</td>
                      <td className="num strong">${o.totalAmount.toFixed(2)}</td>
                      <td><span className={`badge ${STATUS_STYLE[o.status] ?? ''}`}>{o.status}</span></td>
                      <td className="muted">{new Date(o.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && orders.length === 0 && <div className="empty">No orders found.</div>}
        </div>
        {meta && <Pager meta={meta} onPage={setPage} />}
      </div>
    </div>
  );
}
