import { useState } from 'react';
import { useLogin } from '../api/queries';

/** Shown in place of any page while signed out; accounts are created by an administrator. */
export function LoginPage() {
  const login = useLogin();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  return (
    <section className="card login" aria-labelledby="login-h">
      <h1 id="login-h">Sign in</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ name: name.trim(), password });
        }}
      >
        <div className="field">
          <label htmlFor="login-name">Name</label>
          <input
            id="login-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="username"
            required
            maxLength={100}
          />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            maxLength={200}
          />
        </div>
        {login.isError && (
          <p className="error" role="alert">
            {login.error.message}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="muted small">
        No account? Ask the administrator to add you with <code>npm run user -w mlr-backend</code>.
      </p>
    </section>
  );
}
