import { Link, NavLink, Outlet } from 'react-router';
import { useLogout, useMe } from '../api/queries';
import { LoginPage } from '../pages/LoginPage';
import { Disclaimer } from './Disclaimer';

const ROLE_LABEL = { author: 'Author', rule_admin: 'Rule admin' } as const;

export function Layout() {
  const me = useMe();
  const logout = useLogout();
  const user = me.data;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Disclaimer />
      <header className="header">
        <Link to="/" className="brand">
          Pre-MLR Checker
        </Link>
        {user && (
          <>
            <nav className="nav" aria-label="Main">
              <NavLink to="/" end>
                Scans
              </NavLink>
              <NavLink to="/rules">Rules</NavLink>
              <NavLink to="/precedents">Precedent trends</NavLink>
            </nav>
            <div className="account">
              <span>
                Signed in as <strong>{user.name}</strong>{' '}
                <span className="muted">({ROLE_LABEL[user.role]})</span>
              </span>
              <button
                type="button"
                className="btn small"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </header>
      <main className="main" id="main">
        {me.isPending ? (
          <p className="muted">Loading…</p>
        ) : me.isError ? (
          <p className="error" role="alert">
            Could not reach the server: {me.error.message}
          </p>
        ) : user ? (
          <Outlet />
        ) : (
          <LoginPage />
        )}
      </main>
    </>
  );
}
