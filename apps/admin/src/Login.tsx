import { useState } from 'react';
import { api, auth } from './api';

export default function Login({ onSuccess }: { onSuccess: (email: string) => void }) {
  const [email, setEmail] = useState('admin@gmail.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.login(email, password);
      auth.set(res.accessToken);
      onSuccess(res.user.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login">
      <section className="card login-card">
        <div className="brand">
          <div className="brand-logo">🛍️</div>
          <div>
            <h1>Omnichannel</h1>
            <small>Commerce AI Admin</small>
          </div>
        </div>
        <h2>Welcome back</h2>
        <p className="muted">Sign in to manage products, orders and live chats.</p>
        <form onSubmit={submit}>
          {error && <div className="error-box">{error}</div>}
          <label>
            Email
            <input id="login-email" className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input id="login-password" className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </label>
          <button id="login-submit" className="btn primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
