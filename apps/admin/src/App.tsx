import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBagShopping,
  faBoxOpen,
  faComments,
  faMoon,
  faRightFromBracket,
  faShoppingCart,
  faSun,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons';
import { auth, setUnauthorizedHandler } from './api';
import Login from './Login';
import Products from './Products';
import Orders from './Orders';
import Conversations from './Conversations';
import { ToastProvider } from './ui';

type View = 'conversations' | 'products' | 'orders';
type Theme = 'light' | 'dark';

const THEME_KEY = 'omnichannel_admin_theme';

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    /* ignore storage errors */
  }
  return 'light';
}

const NAV: { id: View; icon: IconDefinition; label: string }[] = [
  { id: 'conversations', icon: faComments, label: 'Live chats' },
  { id: 'products', icon: faBoxOpen, label: 'Products' },
  { id: 'orders', icon: faShoppingCart, label: 'Orders' },
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
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    setUnauthorizedHandler(() => setEmail(null));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore storage errors */
    }
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  if (!email) return <Login onSuccess={setEmail} />;

  return (
    <ToastProvider>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-logo">
              <FontAwesomeIcon icon={faBagShopping} />
            </div>
            <div>
              <h1>Omnichannel</h1>
              <small>Commerce AI Admin</small>
            </div>
          </div>

          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <button
                key={n.id}
                id={`nav-${n.id}`}
                className={view === n.id ? 'active' : ''}
                onClick={() => setView(n.id)}
              >
                <span className="nav-icon">
                  <FontAwesomeIcon icon={n.icon} />
                </span>
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
              id="theme-toggle"
              type="button"
              className="btn ghost"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <FontAwesomeIcon icon={theme === 'dark' ? faSun : faMoon} />
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <button
              id="logout"
              className="btn ghost"
              onClick={() => {
                auth.clear();
                setEmail(null);
              }}
            >
              <FontAwesomeIcon icon={faRightFromBracket} />
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
    </ToastProvider>
  );
}
