import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISCLAIMER } from '@pre-mlr/shared';
import { mockApi, route, ruleSummary, ruleVersion, scan, signedIn } from '../test/api';
import { renderApp } from '../test/render';

afterEach(() => vi.unstubAllGlobals());

describe('Scans page', () => {
  it('shows the disclaimer and lists scans with status and counts', async () => {
    mockApi(
      route('GET', '/api/scans', () => ({
        body: [
          scan(),
          scan({
            id: 's2',
            startUrl: 'https://other.test/',
            status: 'failed',
            error: 'Navigation failed',
          }),
        ],
      })),
    );
    renderApp('/');
    expect(screen.getByRole('note')).toHaveTextContent(DISCLAIMER);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('link', { name: 'examplin.test' })).toHaveAttribute(
      'href',
      '/scans/s1',
    );
    expect(rows[0]).toHaveTextContent('3 of 3');
    expect(within(rows[0]!).getByRole('link', { name: 'PDF' })).toHaveAttribute(
      'href',
      '/api/scans/s1/report.pdf',
    );
    expect(rows[1]).toHaveTextContent('failed');
    expect(rows[1]).toHaveTextContent('Navigation failed');
    expect(within(rows[1]!).queryByRole('link', { name: 'PDF' })).toBeNull();
  });

  it('starts a scan with an optional product profile and opens its review page', async () => {
    const calls = mockApi(
      route('GET', '/api/scans', () => ({ body: [] })),
      route('POST', '/api/scans', () => ({
        status: 202,
        body: scan({ id: 'new', status: 'queued', pagesCrawled: 0 }),
      })),
      route('GET', '/api/scans/new', () => ({
        body: scan({ id: 'new', status: 'running', pagesCrawled: 1 }),
      })),
    );
    const user = userEvent.setup();
    renderApp('/');
    await user.type(await screen.findByLabelText('Start URL'), 'http://localhost:4100/');
    await user.clear(screen.getByLabelText('Max pages'));
    await user.type(screen.getByLabelText('Max pages'), '10');
    await user.type(screen.getByLabelText(/Brand name/), 'Examplin, Examplin HFA');
    await user.type(screen.getByLabelText(/Established name/), 'examplitide');
    await user.click(screen.getByRole('button', { name: 'Start scan' }));

    expect(
      await screen.findByText(/Scan running… 1 of up to 25 pages crawled/),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      startUrl: 'http://localhost:4100/',
      maxPages: 10,
      maxDepth: 3,
      product: { brandNames: ['Examplin', 'Examplin HFA'], establishedName: 'examplitide' },
    });
  });

  it('sends per-scan rule choices that differ from the defaults', async () => {
    const calls = mockApi(
      route('GET', '/api/scans', () => ({ body: [] })),
      route('GET', '/api/rules', () => ({
        body: [
          ruleSummary(),
          ruleSummary({
            latest: ruleVersion({
              ruleId: 'off-label-implied',
              title: 'No implied off-label use',
              checkType: 'llm',
              enabledByDefault: false,
            }),
          }),
          ruleSummary({
            latest: ruleVersion({ ruleId: 'gone', title: 'Retired one' }),
            retiredAt: '2026-01-01T00:00:00.000Z',
          }),
        ],
      })),
      route('POST', '/api/scans', () => ({ status: 202, body: scan({ id: 'new' }) })),
      route('GET', '/api/scans/new', () => ({ body: scan({ id: 'new' }) })),
      route('GET', '/api/scans/new/findings', () => ({ body: [] })),
    );
    const user = userEvent.setup();
    renderApp('/');
    await user.type(await screen.findByLabelText('Start URL'), 'http://localhost:4100/');
    const summary = await screen.findByText(/Rules for this scan/);
    await waitFor(() => expect(summary).toHaveTextContent('(1 of 2 on)'));
    await user.click(summary);
    expect(screen.queryByLabelText(/Retired one/)).toBeNull();
    await user.click(screen.getByLabelText(/No unsupported absolute/));
    await user.click(screen.getByLabelText(/No implied off-label use/));
    // Toggling twice returns to the default and isn't sent.
    await user.click(screen.getByLabelText(/No implied off-label use/));
    await user.click(screen.getByLabelText(/No implied off-label use/));
    expect(summary).toHaveTextContent('(1 of 2 on)');
    await user.click(screen.getByRole('button', { name: 'Start scan' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      rules: { enable: ['off-label-implied'], disable: ['superlatives'] },
    });
  });

  it('shows the server error when a scan cannot start', async () => {
    mockApi(
      route('GET', '/api/scans', () => ({ body: [] })),
      route('POST', '/api/scans', () => ({ status: 400, body: { error: 'Invalid request' } })),
    );
    const user = userEvent.setup();
    renderApp('/');
    await user.type(await screen.findByLabelText('Start URL'), 'https://x.test/');
    await user.click(screen.getByRole('button', { name: 'Start scan' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid request'));
  });

  describe('row actions', () => {
    it('runs a scan again and opens the new scan', async () => {
      const calls = mockApi(
        route('GET', '/api/scans', () => ({ body: [scan()] })),
        route('POST', '/api/scans/s1/rerun', () => ({
          status: 202,
          body: scan({ id: 's2', status: 'queued', pagesCrawled: 0 }),
        })),
        route('GET', '/api/scans/s2', () => ({ body: scan({ id: 's2', status: 'queued' }) })),
      );
      const user = userEvent.setup();
      renderApp('/');
      await user.click(
        await screen.findByRole('button', { name: 'Run the examplin.test scan again' }),
      );
      expect(await screen.findByText(/Scan queued/)).toBeInTheDocument();
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/scans/s1/rerun')).toBe(true);
    });

    it('deletes a scan after confirming', async () => {
      let list = [scan(), scan({ id: 's2', startUrl: 'https://other.test/' })];
      const calls = mockApi(
        route('GET', '/api/scans', () => ({ body: list })),
        route('DELETE', '/api/scans/s1', () => {
          list = list.filter((s) => s.id !== 's1');
          return { status: 204, body: null };
        }),
      );
      const user = userEvent.setup();
      renderApp('/');
      await user.click(
        await screen.findByRole('button', { name: 'Delete the examplin.test scan' }),
      );
      const confirm = screen.getByRole('group', {
        name: 'Confirm deleting the examplin.test scan',
      });
      expect(confirm).toHaveTextContent('Delete this scan, its findings and screenshots?');
      await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(screen.queryByText('examplin.test')).toBeNull());
      expect(screen.getByText('other.test')).toBeInTheDocument();
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([
        '/api/scans/s1',
      ]);
    });

    it("hides Delete for other people's scans (unless rule admin) and both actions while running", async () => {
      const list = [
        scan({ id: 'mine' }),
        scan({ id: 'theirs', startUrl: 'https://theirs.test/', createdBy: 'Someone Else' }),
        scan({ id: 'busy', startUrl: 'https://busy.test/', status: 'running' }),
      ];
      mockApi(route('GET', '/api/scans', () => ({ body: list })));
      const view = renderApp('/');
      await screen.findByText('theirs.test');
      const names = () =>
        screen
          .getAllByRole('button')
          .map((b) => b.getAttribute('aria-label'))
          .filter(Boolean);
      expect(names()).toEqual([
        'Run the examplin.test scan again',
        'Delete the examplin.test scan',
        'Run the theirs.test scan again',
      ]);
      view.unmount();

      vi.unstubAllGlobals();
      mockApi(
        route('GET', '/api/me', () => ({ body: { user: signedIn({ role: 'rule_admin' }) } })),
        route('GET', '/api/scans', () => ({ body: list })),
      );
      renderApp('/');
      expect(
        await screen.findByRole('button', { name: 'Delete the theirs.test scan' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete the busy.test scan' })).toBeNull();
    });

    it('shows why a delete was refused', async () => {
      mockApi(
        route('GET', '/api/scans', () => ({ body: [scan()] })),
        route('DELETE', '/api/scans/s1', () => ({
          status: 409,
          body: { error: 'This scan is running. Wait until it finishes, then delete it.' },
        })),
      );
      const user = userEvent.setup();
      renderApp('/');
      await user.click(
        await screen.findByRole('button', { name: 'Delete the examplin.test scan' }),
      );
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('This scan is running');
    });
  });
});
