import { useEffect, useState } from 'react';
import { api, type PageMeta, type ProductsResponse } from './api';
import { Pager, useDebounced } from './ui';

const GENDERS = [
  { value: 'MEN', label: 'Men' },
  { value: 'WOMEN', label: 'Women' },
  { value: 'UNISEX', label: 'Unisex' },
];

const genderLabel = (g: string | null) => GENDERS.find((x) => x.value === g)?.label ?? '—';

export default function Products() {
  const [brand, setBrand] = useState('');
  const [gender, setGender] = useState('');
  const [categoryType, setCategoryType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<ProductsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
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
  }, [page, brand, gender, categoryType, q]);

  const reset = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    fn(e.target.value);
    setPage(1);
  };

  const meta: PageMeta | undefined = res?.meta;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Products</h2>
          <p>{meta ? `${meta.total} apparel items in the catalog` : 'Apparel catalog'}</p>
        </div>
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
              <tr><th>Product</th><th>Brand</th><th>For</th><th>Type</th><th>Price</th><th>Stock</th></tr>
            </thead>
            <tbody>
              {loading && !res
                ? Array.from({ length: 6 }, (_, i) => (
                    <tr key={i}>{Array.from({ length: 6 }, (_, j) => <td key={j}><div className="skeleton" /></td>)}</tr>
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
                    </tr>
                  ))}
            </tbody>
          </table>
          {res && res.data.length === 0 && <div className="empty">No products match these filters.</div>}
        </div>
        {meta && <Pager meta={meta} onPage={setPage} />}
      </div>
    </div>
  );
}
