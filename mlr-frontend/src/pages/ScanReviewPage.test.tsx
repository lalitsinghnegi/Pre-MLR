import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FindingView } from '@pre-mlr/shared';
import { finding, mockApi, route, scan, signedIn, type Call } from '../test/api';
import { renderApp } from '../test/render';

const superlative = () => finding({ id: 'sup', pageNumber: 1, severity: 'major' });
const isi = () =>
  finding({
    id: 'isi',
    pageNumber: 2,
    severity: 'critical',
    ruleId: 'isi-present',
    message: 'No "Important Safety Information" section found on this page.',
    evidenceText: null,
    evidenceLocation: null,
    suggestedFix: 'Add the ISI.',
    rule: {
      ...finding().rule,
      title: 'Important Safety Information is present',
      category: 'safety_information',
    },
  });
const privacy = () =>
  finding({
    id: 'priv',
    pageNumber: null,
    severity: 'minor',
    ruleId: 'privacy-link',
    message: 'No link to the privacy policy on this page.',
    evidenceText: null,
    evidenceLocation: null,
    rule: { ...finding().rule, title: 'Privacy policy link is present', category: 'legal_privacy' },
  });

let db: Map<string, FindingView>;
let calls: Call[];
let role: 'author' | 'rule_admin';

/** A tiny in-memory backend: PATCH and bulk apply changes and bump revisions, like the real API. */
function backend(extra: Parameters<typeof mockApi> = []) {
  return mockApi(
    ...extra,
    route('GET', '/api/scans/s1', () => ({ body: scan() })),
    route('GET', '/api/scans/s1/findings', () => ({ body: [...db.values()] })),
    route('GET', /^\/api\/findings\/[^/]+\/audit$/, () => ({ body: [] })),
    route('GET', '/api/me', () => ({ body: { user: signedIn({ role }) } })),
    route('PATCH', /^\/api\/findings\/[^/]+$/, (c) => {
      const id = c.path.split('/').pop()!;
      const f = db.get(id)!;
      const u = c.body as {
        status?: FindingView['status'];
        editedFix?: string;
        comment?: string | null;
        expectedRevision: number;
      };
      if (u.expectedRevision !== f.revision)
        return {
          status: 409,
          body: { error: `Finding ${id} was changed by someone else`, current: f },
        };
      const next = {
        ...f,
        status: u.status ?? (u.editedFix ? 'edited' : f.status),
        editedFix: u.editedFix ?? f.editedFix,
        authorComment: u.comment !== undefined ? u.comment : f.authorComment,
        revision: f.revision + 1,
      } satisfies FindingView;
      db.set(id, next);
      return { body: next };
    }),
    route('POST', '/api/findings/bulk', (c) => {
      const { items, status, comment } = c.body as {
        items: { id: string }[];
        status: FindingView['status'];
        comment?: string;
      };
      const updated = items.map(({ id }) => {
        const f = {
          ...db.get(id)!,
          status,
          authorComment: comment ?? null,
          revision: db.get(id)!.revision + 1,
        };
        db.set(id, f);
        return f;
      });
      return { body: updated };
    }),
  );
}

const grid = () => screen.getByRole('grid');
/**
 * Click inside an AG Grid cell. user-event's full pointer sequence doesn't reach cell renderers in
 * jsdom (real browsers are fine; see the Playwright run), so grid cells get a plain click event.
 */
const clickInGrid = (el: HTMLElement) => act(() => fireEvent.click(el));
const rowOf = (text: string) =>
  within(grid())
    .getAllByRole('row')
    .find((r) => r.textContent?.includes(text))!;
const status = () => screen.getByRole('status');

beforeEach(() => {
  db = new Map([superlative(), isi(), privacy()].map((f) => [f.id, f]));
  role = 'author';
});
afterEach(() => vi.unstubAllGlobals());

describe('Scan review page', () => {
  it('shows findings grouped by page with the summary and PDF link', async () => {
    calls = backend();
    renderApp('/scans/s1');
    expect(await screen.findByText('Showing 3 of 3 findings')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Review: examplin.test' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute(
      'href',
      '/api/scans/s1/report.pdf',
    );
    const groups = within(grid())
      .getAllByRole('button', { expanded: true })
      .map((b) => b.textContent?.trim());
    expect(groups).toEqual(['▾ Site-wide', '▾ #1 / · Page 1', '▾ #2 /page-2 · Page 2']);
    expect(rowOf('Examplin is the best inhaler')).toHaveTextContent('Major');
  });

  it('filters by severity and collapses groups', async () => {
    calls = backend();
    const user = userEvent.setup();
    renderApp('/scans/s1');
    await screen.findByText('Showing 3 of 3 findings');
    await user.click(screen.getByRole('checkbox', { name: 'Critical' }));
    expect(screen.getByText('Showing 1 of 3 findings')).toBeInTheDocument();
    expect(within(grid()).queryByText(/best inhaler/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    clickInGrid(within(grid()).getByRole('button', { name: /#1 \/ · Page 1/ }));
    expect(within(grid()).getByRole('button', { name: /#1 \/ · Page 1/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(within(grid()).queryByText(/best inhaler/)).toBeNull();
  });

  it('accepts a finding: sends the revision and reviewer, updates the row and announces it', async () => {
    calls = backend();
    renderApp('/scans/s1');
    await screen.findByText('Showing 3 of 3 findings');
    clickInGrid(
      screen.getByRole('button', {
        name: 'Accept: No unsupported absolute or superlative language on #1 /',
      }),
    );

    await waitFor(() =>
      expect(status()).toHaveTextContent(
        'Accepted: No unsupported absolute or superlative language on #1 /.',
      ),
    );
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.path).toBe('/api/findings/sup');
    expect(patch.body).toEqual({ status: 'accepted', expectedRevision: 1 });
    expect(rowOf('best inhaler')).toHaveTextContent('Accepted');
    expect(
      within(rowOf('best inhaler')).getByRole('button', { name: /^Reopen:/ }),
    ).toBeInTheDocument();
  });

  it('shows a conflict message and the latest version instead of overwriting', async () => {
    calls = backend();
    renderApp('/scans/s1');
    await screen.findByText('Showing 3 of 3 findings');
    // Someone else rejects it after the page loaded.
    db.set('sup', { ...db.get('sup')!, status: 'rejected', revision: 2, updatedBy: 'Other' });
    clickInGrid(screen.getByRole('button', { name: /^Accept: No unsupported/ }));

    await waitFor(() =>
      expect(status()).toHaveTextContent(
        'Someone else changed "No unsupported absolute or superlative language on #1 /"',
      ),
    );
    expect(rowOf('best inhaler')).toHaveTextContent('Rejected');
    expect(db.get('sup')!.status).toBe('rejected');
  });

  it('edits a fix in the dialog, keeping the original suggestion visible', async () => {
    calls = backend();
    const user = userEvent.setup();
    renderApp('/scans/s1');
    await screen.findByText('Showing 3 of 3 findings');
    clickInGrid(screen.getByRole('button', { name: /^Edit fix: No unsupported/ }));
    const dialog = screen.getByRole('dialog', { name: 'Edit suggested fix' });
    expect(
      within(dialog).getByText('Rephrase without this language.', { selector: 'p' }),
    ).toBeInTheDocument();
    const fix = within(dialog).getByLabelText('Your fix');
    await user.clear(fix);
    await user.type(fix, 'An effective inhaler option');
    await user.type(within(dialog).getByLabelText('Comment (optional)'), 'Per brand team');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(status()).toHaveTextContent('Fix edited'));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      editedFix: 'An effective inhaler option',
      comment: 'Per brand team',
      expectedRevision: 1,
    });
    expect(rowOf('best inhaler')).toHaveTextContent('Edited');
    expect(rowOf('best inhaler')).toHaveTextContent('An effective inhaler option');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Row selection, bulk actions and row-click preview rely on AG Grid's own event handling, which
  // jsdom doesn't support; they are covered in a real browser by mlr-backend/test/ui-e2e.test.ts.

  it('previews the screenshot with the evidence box scaled to the image', async () => {
    calls = backend();
    const user = userEvent.setup();
    renderApp('/scans/s1');
    await screen.findByText('Showing 3 of 3 findings');
    // Any row action focuses the finding; open and cancel the comment dialog to get there.
    clickInGrid(within(rowOf('best inhaler')).getByRole('button', { name: /^Comment:/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    const preview = screen.getByRole('complementary', { name: 'Finding details' });
    const img = within(preview).getByRole('img', {
      name: 'desktop screenshot of https://examplin.test/',
    });
    expect(img).toHaveAttribute('src', '/api/scans/s1/pages/p1/screenshot/desktop');
    Object.defineProperty(img, 'naturalWidth', { value: 1000 });
    Object.defineProperty(img, 'naturalHeight', { value: 2000 });
    act(() => {
      fireEvent.load(img);
    });
    expect(within(preview).getByTestId('evidence-box')).toHaveStyle({
      left: '10%',
      top: '10%',
      width: '40%',
      height: '2.5%',
    });
    expect(within(preview).getByRole('link', { name: '21 CFR 202.1(e)(6)(i)' })).toHaveAttribute(
      'href',
      'https://www.law.cornell.edu/cfr/text/21/202.1',
    );

    // Mobile has no location for this finding.
    await user.click(within(preview).getByRole('tab', { name: 'Mobile' }));
    expect(within(preview).queryByTestId('evidence-box')).toBeNull();
    expect(
      within(preview).getByText('The evidence location is marked on the desktop screenshot.'),
    ).toBeInTheDocument();
  });

  it('shows similar past comments as advisory, with promote only for rule admins', async () => {
    db.set(
      'sup',
      finding({
        ...superlative(),
        precedents: [
          {
            id: 'prec-1',
            text: '"Best-in-class" is a superlative we cannot support.',
            site: 'fictorex.test',
            brand: 'Fictorex',
            commentedAt: '2025-03-04',
            reviewerFunction: 'legal',
            outcome: 'accepted',
            category: 'claims',
            rank: 1,
            similarity: 0.734,
          },
        ],
      }),
    );
    const openPreview = async () => {
      await screen.findByText('Showing 3 of 3 findings');
      clickInGrid(within(rowOf('best inhaler')).getByRole('button', { name: /^Comment:/ }));
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
      );
      return within(screen.getByRole('complementary', { name: 'Finding details' }));
    };

    calls = backend();
    const view = renderApp('/scans/s1');
    let preview = await openPreview();
    const section = within(preview.getByRole('region', { name: 'Similar past MLR comments' }));
    expect(section.getByText(/less authority than the rule above/)).toBeInTheDocument();
    expect(section.getByText(/Best-in-class/)).toBeInTheDocument();
    expect(
      section.getByText(
        'Legal · Fictorex · fictorex.test · 2025-03-04 · outcome: accepted · 73% similar',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.path === '/api/me')).toBe(true));
    expect(section.queryByRole('button', { name: 'Promote to rule candidate' })).toBeNull();
    view.unmount();

    role = 'rule_admin';
    calls = backend([
      route('POST', '/api/rule-candidates', (c) => ({
        status: 201,
        body: {
          id: 'rc1',
          status: 'proposed',
          scanId: 's1',
          createdBy: 'Pat Reviewer',
          createdAt: '2026-10-04T10:00:00.000Z',
          examples: [],
          note: null,
          findingId: 'sup',
          ...(c.body as object),
        },
      })),
    ]);
    const user = userEvent.setup();
    renderApp('/scans/s1');
    preview = await openPreview();
    await user.click(await preview.findByRole('button', { name: 'Promote to rule candidate' }));
    const title = preview.getByLabelText('Working title for the proposed rule');
    expect(title).toHaveValue('"Best-in-class" is a superlative we cannot support.');
    await user.clear(title);
    await user.type(title, 'No best-in-class claims');
    await user.type(preview.getByLabelText(/Note for the rule owners/), 'Recurring.');
    await user.click(preview.getByRole('button', { name: 'Propose' }));
    expect(await preview.findByText('Proposed as a rule candidate.')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/rule-candidates')!;
    expect(post.body).toEqual({
      title: 'No best-in-class claims',
      precedentIds: ['prec-1'],
      findingId: 'sup',
      note: 'Recurring.',
    });
  });

  it('lists the rule versions the scan ran with, and links findings to their version', async () => {
    calls = backend([
      route('GET', '/api/scans/s1/rules', () => ({
        body: [
          {
            ruleId: 'superlatives',
            version: 2,
            title: 'No unsupported superlatives',
            category: 'claims',
            severity: 'major',
            checkType: 'deterministic',
            enabled: true,
            findings: 1,
          },
          {
            ruleId: 'off-label-implied',
            version: 1,
            title: 'No implied off-label use',
            category: 'claims',
            severity: 'critical',
            checkType: 'llm',
            enabled: false,
            findings: 0,
          },
        ],
      })),
    ]);
    const user = userEvent.setup();
    renderApp('/scans/s1');
    await screen.findByText('Showing 3 of 3 findings');
    expect(rowOf('best inhaler')).toHaveTextContent('superlatives v1');
    const panel = await screen.findByText(/Rules used/);
    await waitFor(() => expect(panel).toHaveTextContent('Rules used (1 of 2 on)'));
    await user.click(panel);
    expect(screen.getByRole('link', { name: 'No unsupported superlatives' })).toHaveAttribute(
      'href',
      '/rules/superlatives?version=2',
    );
    expect(screen.getByRole('row', { name: /No implied off-label use/ })).toHaveTextContent(
      /v1ClaimsAI \(LLM\)No0/,
    );

    clickInGrid(within(rowOf('best inhaler')).getByRole('button', { name: /^Comment:/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    const preview = screen.getByRole('complementary', { name: 'Finding details' });
    expect(within(preview).getByRole('link', { name: 'superlatives v1' })).toHaveAttribute(
      'href',
      '/rules/superlatives?version=1',
    );
  });

  it('marks AI findings with confidence and shows the page tip', async () => {
    db.set('ai', {
      ...finding({
        id: 'ai',
        ruleId: 'off-label-implied',
        detectedBy: 'llm',
        confidence: 0.85,
        evidenceText: 'Also for seasonal allergies.',
      }),
      page: { ...finding().page!, tip: 'Remove the allergy claim.' },
    });
    calls = backend();
    const user = userEvent.setup();
    renderApp('/scans/s1');
    await screen.findByText('Showing 4 of 4 findings');
    expect(within(rowOf('seasonal allergies')).getByText('AI 85%')).toBeInTheDocument();
    expect(within(rowOf('best inhaler')).queryByText(/^AI/)).toBeNull();
    clickInGrid(within(rowOf('seasonal allergies')).getByRole('button', { name: /^Comment:/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('region', { name: 'Page tip' })).toHaveTextContent(
      'Remove the allergy claim.',
    );
  });

  it('shows progress and the current phase while the scan is running', async () => {
    mockApi(
      route('GET', '/api/scans/s1', () => ({
        body: scan({ status: 'running', phase: 'analyzing', pagesCrawled: 2 }),
      })),
    );
    renderApp('/scans/s1');
    expect(
      await screen.findByText(/Scan running \(running AI analysis\)… 2 of up to 25 pages crawled/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
  });
});
