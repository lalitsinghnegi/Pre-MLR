import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISCLAIMER } from '@pre-mlr/shared';
import { mockApi, route, scan, signedIn } from '../test/api';
import { renderApp } from '../test/render';

afterEach(() => vi.unstubAllGlobals());

describe('sign-in', () => {
  it('shows the sign-in page when signed out, then the app after signing in', async () => {
    let session = false;
    const calls = mockApi(
      route('GET', '/api/me', () => ({ body: { user: session ? signedIn() : null } })),
      route('POST', '/api/auth/login', (c) => {
        const { password } = c.body as { password: string };
        if (password !== 'correct horse battery') {
          return { status: 401, body: { error: 'Wrong name or password.' } };
        }
        session = true;
        return { body: signedIn() };
      }),
      route('GET', '/api/scans', () => ({ body: [scan()] })),
    );
    const user = userEvent.setup();
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(DISCLAIMER);
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(calls.some((c) => c.path === '/api/scans')).toBe(false);

    await user.type(screen.getByLabelText('Name'), 'Pat Reviewer');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong name or password.');

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Scans' })).toBeInTheDocument();
    expect(screen.getByText(/Signed in as/)).toHaveTextContent(
      'Signed in as Pat Reviewer (Author)',
    );
    const login = calls.filter((c) => c.path === '/api/auth/login').at(-1)!;
    expect(login.body).toEqual({ name: 'Pat Reviewer', password: 'correct horse battery' });
  });

  it('signs out', async () => {
    let session = true;
    const calls = mockApi(
      route('GET', '/api/me', () => ({ body: { user: session ? signedIn() : null } })),
      route('POST', '/api/auth/logout', () => {
        session = false;
        return { status: 204, body: null };
      }),
      route('GET', '/api/scans', () => ({ body: [] })),
    );
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/auth/logout')).toBe(true);
  });

  it('goes back to the sign-in page when the session expires mid-use', async () => {
    let session = true;
    mockApi(
      route('GET', '/api/me', () => ({ body: { user: session ? signedIn() : null } })),
      route('GET', '/api/scans', () => {
        session = false; // the server forgot us
        return { status: 401, body: { error: 'Sign in to continue.' } };
      }),
    );
    renderApp('/');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument(),
    );
  });
});
