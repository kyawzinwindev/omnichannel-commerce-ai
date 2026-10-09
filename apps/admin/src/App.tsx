import { useEffect, useState } from 'react';
import { auth, setUnauthorizedHandler } from './api';
import Login from './Login';
import Products from './Products';
import Orders from './Orders';
import Conversations from './Conversations';

type View = 'conversations' | 'products' | 'orders';

const NAV: { id: View; icon: string; label: string }[] = [
  { id: 'conversations', icon: '💬', label: 'Live chats' },
  { id: 'products', icon: '👕', label: 'Products' },
  { id: 'orders', icon: '📦', label: 'Orders' },
];

function readEmail(): string {
  try {
    const payload = JSON.parse(atob((auth.token ?? '').split('.')[1]));
    return payload.email ?? 'admin';
  } catch {
    return 'admin';
  }
}

export default function App() {
  const [email, setEmail] = useState<string | null>(auth.token ? readEmail() : null);
  const [view, setView] = useState<View>('conversations');

  useEffect(() => {
    setUnauthorizedHandler(() => setEmail(null));
  }, []);

  if (!email) return <Login onSuccess={setEmail} />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">🛍️</div>
          <div>
            <h1>Omnichannel</h1>
            <small>Commerce AI Admin</small>
          </div>
        </div>

        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <button key={n.id} id={`nav-${n.id}`} className={view === n.id ? 'active' : ''} onClick={() => setView(n.id)}>
              <span>{n.icon}</span>
              <span className="label">{n.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{email[0].toUpperCase()}</div>
            <span className="email">{email}</span>
          </div>
          <button
            id="logout"
            className="btn ghost"
            onClick={() => {
              auth.clear();
              setEmail(null);
            }}
          >
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="view" key={view}>
          {view === 'conversations' && <Conversations />}
          {view === 'products' && <Products />}
          {view === 'orders' && <Orders />}
        </div>
      </main>
    </div>
  );
}
