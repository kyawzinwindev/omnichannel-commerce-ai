import { useEffect, useState } from 'react';
import { api, type Gender, type PageMeta, type Product, type ProductInput, type ProductsResponse } from './api';
import { ConfirmDialog, Modal, Pager, useDebounced, useToast } from './ui';

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'MEN', label: 'Men' },
  { value: 'WOMEN', label: 'Women' },
  { value: 'UNISEX', label: 'Unisex' },
];

const genderLabel = (g: string | null) => GENDERS.find((x) => x.value === g)?.label ?? '—';

interface FormState {
  name: string;
  brand: string;
  targetGender: Gender;
  categoryType: string;
  price: string;
  stock: string;
  description: string;
}

const emptyForm: FormState = { name: '', brand: '', targetGender: 'UNISEX', categoryType: '', price: '', stock: '0', description: '' };

const toForm = (p: Product): FormState => ({
  name: p.name,
  brand: p.brand ?? '',
  targetGender: p.targetGender ?? 'UNISEX',
  categoryType: p.categoryType ?? '',
  price: String(p.price),
  stock: String(p.stock),
  description: p.description ?? '',
});

type Errors = Partial<Record<keyof FormState, string>>;

function validate(f: FormState): Errors {
  const e: Errors = {};
  if (!f.name.trim()) e.name = 'Name is required';
  if (!f.brand.trim()) e.brand = 'Brand is required';
  if (!f.categoryType.trim()) e.categoryType = 'Category type is required';
  const price = Number(f.price);
  if (f.price === '' || Number.isNaN(price) || price < 0) e.price = 'Enter a valid price (≥ 0)';
  else if (!/^\d+(\.\d{1,2})?$/.test(f.price.trim())) e.price = 'At most 2 decimal places';
  const stock = Number(f.stock);
  if (f.stock === '' || !Number.isInteger(stock) || stock < 0) e.stock = 'Stock must be a whole number ≥ 0';
  return e;
}

function ProductForm({ product, brands, types, onClose, onSaved }: {
  product: Product | null;
  brands: string[];
  types: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(product ? toForm(product) : emptyForm);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body: ProductInput = {
      name: form.name.trim(),
      brand: form.brand.trim(),
      targetGender: form.targetGender,
      categoryType: form.categoryType.trim(),
      price: Number(form.price),
      stock: Number(form.stock),
      description: form.description.trim(),
    };
    setSaving(true);
    try {
      if (product) await api.updateProduct(product.id, body);
      else await api.createProduct(body);
      toast('success', product ? `Updated “${body.name}”` : `Added “${body.name}”`);
      onSaved();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not save product');
    } finally {
      setSaving(false);
    }
  }

  const err = (k: keyof FormState) => errors[k] && <span className="field-error">{errors[k]}</span>;

  return (
    <Modal title={product ? 'Edit product' : 'Add product'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="modal-body form-grid">
          <label className="span-2">Name
            <input id="product-name" className="field" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
            {err('name')}
          </label>
          <label>Brand
            <input id="product-brand" className="field" list="brand-options" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
            <datalist id="brand-options">{brands.map((b) => <option key={b} value={b} />)}</datalist>
            {err('brand')}
          </label>
          <label>Category type
            <input id="product-type" className="field" list="type-options" value={form.categoryType} onChange={(e) => set('categoryType', e.target.value)} />
            <datalist id="type-options">{types.map((t) => <option key={t} value={t} />)}</datalist>
            {err('categoryType')}
          </label>
          <label>Target gender
            <select id="product-gender" className="field" value={form.targetGender} onChange={(e) => set('targetGender', e.target.value as Gender)}>
              {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </label>
          <label>Price ($)
            <input id="product-price" className="field" inputMode="decimal" value={form.price} onChange={(e) => set('price', e.target.value)} />
            {err('price')}
          </label>
          <label>Stock
            <input id="product-stock" className="field" inputMode="numeric" value={form.stock} onChange={(e) => set('stock', e.target.value)} />
            {err('stock')}
          </label>
          <label className="span-2">Description
            <textarea id="product-description" className="field" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </label>
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button id="product-save" className="btn primary" disabled={saving}>{saving ? 'Saving…' : product ? 'Save changes' : 'Add product'}</button>
        </footer>
      </form>
    </Modal>
  );
}

export default function Products() {
  const toast = useToast();
  const [brand, setBrand] = useState('');
  const [gender, setGender] = useState('');
  const [categoryType, setCategoryType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<ProductsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounced(search);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .products({ page, pageSize: 12, brand, gender, categoryType, search: q })
      .then((r) => !cancelled && (setRes(r), setError('')))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page, brand, gender, categoryType, q, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const reset = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    fn(e.target.value);
    setPage(1);
  };

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.deleteProduct(deleting.id);
      toast('success', `Deleted “${deleting.name}”`);
      // Step back a page if we just removed the last row of this one.
      if (res && res.data.length === 1 && page > 1) setPage(page - 1);
      reload();
      setDeleting(null);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not delete product');
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  const meta: PageMeta | undefined = res?.meta;
  const COLS = 7;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Products</h2>
          <p>{meta ? `${meta.total} apparel items in the catalog` : 'Apparel catalog'}</p>
        </div>
        <button id="add-product" className="btn primary" onClick={() => setEditing('new')}>＋ Add product</button>
      </header>

      <div className="toolbar">
        <input id="product-search" className="field search" placeholder="Search products…" value={search} onChange={reset(setSearch)} />
        <select id="filter-brand" className="field" value={brand} onChange={reset(setBrand)}>
          <option value="">All brands</option>
          {res?.filters.brands.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select id="filter-gender" className="field" value={gender} onChange={reset(setGender)}>
          <option value="">Men / Women / Unisex</option>
          {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
        <select id="filter-type" className="field" value={categoryType} onChange={reset(setCategoryType)}>
          <option value="">All types</option>
          {res?.filters.categoryTypes.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Product</th><th>Brand</th><th>For</th><th>Type</th><th>Price</th><th>Stock</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
            </thead>
            <tbody>
              {loading && !res
                ? Array.from({ length: 6 }, (_, i) => (
                    <tr key={i}>{Array.from({ length: COLS }, (_, j) => <td key={j}><div className="skeleton" /></td>)}</tr>
                  ))
                : res?.data.map((p) => (
                    <tr key={p.id}>
                      <td className="strong">
                        {p.name}
                        <div className="cell-sub" title={p.description ?? ''}>{p.description}</div>
                      </td>
                      <td><span className="badge accent">{p.brand}</span></td>
                      <td>{genderLabel(p.targetGender)}</td>
                      <td className="muted">{p.categoryType}</td>
                      <td className="num strong">${p.price.toFixed(2)}</td>
                      <td className="num">
                        {p.stock === 0 ? <span className="stock-out">Out of stock</span>
                          : p.stock <= 10 ? <span className="stock-low">{p.stock} · low</span>
                          : p.stock}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button id={`edit-product-${p.id}`} className="btn ghost sm" onClick={() => setEditing(p)}>Edit</button>
                          <button id={`delete-product-${p.id}`} className="btn ghost sm danger-text" onClick={() => setDeleting(p)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {res && res.data.length === 0 && <div className="empty">No products match these filters.</div>}
        </div>
        {meta && <Pager meta={meta} onPage={setPage} />}
      </div>

      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          brands={res?.filters.brands ?? []}
          types={res?.filters.categoryTypes ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete product"
          message={<>Delete <strong>{deleting.name}</strong>? This cannot be undone.</>}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
