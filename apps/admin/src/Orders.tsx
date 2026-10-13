import { useEffect, useState } from 'react';
import { api, type Order, type OrderStatus, type PageMeta } from './api';
import { ConfirmDialog, Modal, Pager, useDebounced, useToast } from './ui';

const STATUS_STYLE: Record<string, string> = {
  accepted: 'success',
  delivered: 'success',
  rejected: 'danger',
  pending: 'warning',
  processing: 'warning',
};

const STATUSES: OrderStatus[] = ['pending', 'processing', 'accepted', 'delivered', 'rejected'];

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function OrderDrawer({ order, busy, onStatus, onDelete, onClose }: {
  order: Order;
  busy: boolean;
  onStatus: (s: OrderStatus) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Modal drawer title={`Order #${order.orderNumber}`} onClose={onClose}>
      <div className="modal-body drawer-body">
        <section>
          <div className="section-title">Status</div>
          <div className="status-row">
            <span className={`badge ${STATUS_STYLE[order.status] ?? ''}`}>{order.status}</span>
            <select
              id="order-status-select"
              className="field"
              value={order.status}
              disabled={busy}
              onChange={(e) => onStatus(e.target.value as OrderStatus)}
            >
              {!STATUSES.includes(order.status as OrderStatus) && <option value={order.status}>{order.status}</option>}
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="quick-actions">
            <button className="btn sm" disabled={busy || order.status === 'accepted'} onClick={() => onStatus('accepted')}>Accept</button>
            <button className="btn sm" disabled={busy || order.status === 'rejected'} onClick={() => onStatus('rejected')}>Reject</button>
            <button className="btn sm" disabled={busy || order.status === 'delivered'} onClick={() => onStatus('delivered')}>Mark delivered</button>
          </div>
        </section>

        <section>
          <div className="section-title">Customer</div>
          <dl className="kv">
            <dt>Name</dt><dd>{order.customer.name ?? '—'}</dd>
            <dt>Phone</dt><dd>{order.customer.phone ?? '—'}</dd>
            <dt>Email</dt><dd>{order.customer.email ?? '—'}</dd>
            <dt>Ship to</dt><dd>{order.customer.shippingAddress ?? '—'}</dd>
            <dt>Placed</dt><dd>{new Date(order.createdAt).toLocaleString()}</dd>
          </dl>
        </section>

        <section>
          <div className="section-title">Items</div>
          <table className="items-table">
            <thead><tr><th>Item</th><th>Qty</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}<div className="cell-sub">${i.price.toFixed(2)} each</div></td>
                  <td className="num">{i.quantity}</td>
                  <td className="num" style={{ textAlign: 'right' }}>${(i.price * i.quantity).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="total-row"><span>Total</span><strong>${order.totalAmount.toFixed(2)}</strong></div>
        </section>
      </div>
      <footer className="modal-foot">
        <button id="order-delete" className="btn ghost danger-text" disabled={busy} onClick={onDelete}>Cancel &amp; remove order</button>
        <button className="btn" onClick={onClose}>Close</button>
      </footer>
    </Modal>
  );
}

export default function Orders() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<PageMeta>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Order | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = useDebounced(search);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .orders({ page, pageSize: 10, status, search: q, from, to })
      .then((r) => !cancelled && (setOrders(r.data), setMeta(r.meta), setError('')))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page, status, q, from, to, reloadKey]);

  const patchLocal = (o: Order) => {
    setOrders((prev) => prev.map((x) => (x.id === o.id ? o : x)));
    setSelected((cur) => (cur?.id === o.id ? o : cur));
  };

  async function changeStatus(order: Order, next: OrderStatus) {
    if (order.status === next) return;
    setBusy(true);
    try {
      const { data } = await api.updateOrderStatus(order.id, next);
      patchLocal(data);
      toast('success', `Order #${order.orderNumber} marked ${next}`);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not update status');
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!selected) return;
    setBusy(true);
    try {
      await api.deleteOrder(selected.id);
      toast('success', `Order #${selected.orderNumber} removed`);
      if (orders.length === 1 && page > 1) setPage(page - 1);
      setSelected(null);
      setConfirmDelete(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not remove order');
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  const filter = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    fn(e.target.value);
    setPage(1);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Orders</h2>
          <p>{meta ? `${meta.total} orders placed through the assistant` : 'Customer orders'}</p>
        </div>
      </header>

      <div className="toolbar">
        <input id="order-search" className="field search" placeholder="Search by order # or customer…" value={search} onChange={filter(setSearch)} />
        <select id="filter-status" className="field" value={status} onChange={filter(setStatus)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <input id="filter-from" type="date" className="field" title="From date" value={from} max={to || undefined} onChange={filter(setFrom)} />
        <input id="filter-to" type="date" className="field" title="To date" value={to} min={from || undefined} onChange={filter(setTo)} />
        {(from || to) && <button className="btn ghost" onClick={() => { setFrom(''); setTo(''); setPage(1); }}>Clear dates</button>}
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Placed</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
            </thead>
            <tbody>
              {loading && orders.length === 0
                ? Array.from({ length: 5 }, (_, i) => (
                    <tr key={i}>{Array.from({ length: 7 }, (_, j) => <td key={j}><div className="skeleton" /></td>)}</tr>
                  ))
                : orders.map((o) => (
                    <tr key={o.id} className="clickable" onClick={() => setSelected(o)}>
                      <td className="strong">#{o.orderNumber}</td>
                      <td>
                        {o.customer.name ?? '—'}
                        <div className="cell-sub">{o.customer.phone ?? o.customer.email}</div>
                        {o.customer.shippingAddress && <div className="cell-sub">{o.customer.shippingAddress}</div>}
                      </td>
                      <td style={{ maxWidth: 280 }}>{o.itemsSummary || '—'}</td>
                      <td className="num strong">${o.totalAmount.toFixed(2)}</td>
                      <td><span className={`badge ${STATUS_STYLE[o.status] ?? ''}`}>{o.status}</span></td>
                      <td className="muted">{fmtDate(o.createdAt)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          <select
                            id={`order-status-${o.id}`}
                            className="field sm"
                            aria-label="Change status"
                            value={o.status}
                            onChange={(e) => changeStatus(o, e.target.value as OrderStatus)}
                          >
                            {!STATUSES.includes(o.status as OrderStatus) && <option value={o.status}>{o.status}</option>}
                            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <button id={`view-order-${o.id}`} className="btn ghost sm" onClick={() => setSelected(o)}>Details</button>
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && orders.length === 0 && <div className="empty">No orders found.</div>}
        </div>
        {meta && <Pager meta={meta} onPage={setPage} />}
      </div>

      {selected && (
        <OrderDrawer
          order={selected}
          busy={busy}
          onStatus={(s) => changeStatus(selected, s)}
          onDelete={() => setConfirmDelete(true)}
          onClose={() => setSelected(null)}
        />
      )}

      {selected && confirmDelete && (
        <ConfirmDialog
          title="Cancel & remove order"
          message={<>Permanently remove order <strong>#{selected.orderNumber}</strong> and its items? This cannot be undone.</>}
          confirmLabel="Remove order"
          busy={busy}
          onConfirm={removeSelected}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
