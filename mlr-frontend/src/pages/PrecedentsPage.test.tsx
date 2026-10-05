import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRECEDENT_BUCKETS,
  type BucketCounts,
  type CandidateRules,
  type PrecedentTrends,
  type RuleCandidate,
} from '@pre-mlr/shared';
import { mockApi, route, signedIn } from '../test/api';
import { renderApp } from '../test/render';

afterEach(() => vi.unstubAllGlobals());

const ruleCandidate: RuleCandidate = {
  id: 'rc1',
  title: 'Confirm image licensing',
  status: 'proposed',
  precedentIds: ['p1', 'p2', 'p3'],
  findingId: null,
  scanId: null,
  note: 'Legal keeps raising this.',
  createdBy: 'Robin Admin',
  createdAt: '2026-10-04T09:00:00.000Z',
  examples: [
    {
      id: 'p1',
      text: 'Confirm we have licensing rights for this stock photo.',
      brand: 'Examplin',
      reviewerFunction: 'legal',
      commentedAt: '2025-01-03',
    },
  ],
};

/** /api/me and /api/rule-candidates, which every render of the page calls. */
const people = (role: 'author' | 'rule_admin' = 'author', list: RuleCandidate[] = []) => [
  route('GET', '/api/me', () => ({ body: { user: signedIn({ role }) } })),
  route('GET', '/api/rule-candidates', () => ({ body: list })),
];

const counts = (o: Partial<BucketCounts>): BucketCounts =>
  ({ ...Object.fromEntries(PRECEDENT_BUCKETS.map((b) => [b, 0])), ...o }) as BucketCounts;

const trends = (o: Partial<PrecedentTrends> = {}): PrecedentTrends => ({
  interval: 'month',
  totals: { comments: 9, classified: 8, noMatchingRule: 3, unclassified: 1 },
  overTime: [
    { period: '2025-01', total: 5, counts: counts({ claims: 3, no_matching_rule: 2 }) },
    { period: '2025-02', total: 0, counts: counts({}) },
    {
      period: '2025-03',
      total: 4,
      counts: counts({ claims: 2, no_matching_rule: 1, unclassified: 1 }),
    },
  ],
  byCategory: [
    { bucket: 'claims', total: 5 },
    { bucket: 'no_matching_rule', total: 3 },
    { bucket: 'unclassified', total: 1 },
  ],
  byBrand: [
    { key: 'Examplin', total: 6, counts: counts({ claims: 4, no_matching_rule: 2 }) },
    {
      key: 'Fictorex',
      total: 3,
      counts: counts({ claims: 1, no_matching_rule: 1, unclassified: 1 }),
    },
  ],
  byReviewerFunction: [
    { key: 'legal', total: 9, counts: counts({ claims: 5, no_matching_rule: 3, unclassified: 1 }) },
  ],
  filterOptions: {
    brands: ['Examplin', 'Fictorex'],
    reviewerFunctions: ['legal', 'medical'],
    firstDate: '2025-01-03',
    lastDate: '2025-03-28',
  },
  classifiers: ['mock:mock-1'],
  ...o,
});

const candidates: CandidateRules = {
  noMatchTotal: 3,
  clustered: 3,
  candidates: [
    {
      label: 'image rights',
      terms: ['image', 'right', 'licensing'],
      count: 3,
      proofs: 3,
      brands: ['Examplin', 'Fictorex'],
      reviewerFunctions: ['legal'],
      firstSeen: '2025-01-03',
      lastSeen: '2025-03-28',
      examples: [
        {
          id: 'p3',
          text: 'Confirm we have licensing rights for this stock photo.',
          brand: 'Examplin',
          reviewerFunction: 'legal',
          commentedAt: '2025-03-28',
        },
      ],
      precedentIds: ['p1', 'p2', 'p3'],
    },
  ],
};

describe('Precedent trends page', () => {
  it('shows totals, small multiples, heat tables and candidate rules', async () => {
    mockApi(
      ...people(),
      route('GET', '/api/precedents/trends', () => ({ body: trends() })),
      route('GET', '/api/precedents/candidates', () => ({ body: candidates })),
    );
    renderApp('/precedents');
    expect(await screen.findByRole('heading', { name: 'Precedent trends' })).toBeInTheDocument();
    expect(screen.getByText(/advisory context only/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Precedent trends' })).toHaveClass('active');

    const tiles = await screen.findByText('No matching rule', { selector: 'dt' });
    expect(tiles.nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText(/1 comment is not classified yet/)).toBeInTheDocument();
    expect(screen.getByText('Classified by mock:mock-1.')).toBeInTheDocument();

    // One panel per bucket with comments, in frequency order, each described for screen readers.
    const panels = screen.getAllByRole('img');
    expect(panels.map((p) => p.getAttribute('aria-label'))).toEqual([
      'Claims: 5 comments from 2025-01 to 2025-03',
      'No matching rule: 3 comments from 2025-01 to 2025-03',
      'Unclassified: 1 comments from 2025-01 to 2025-03',
    ]);
    // Empty periods draw no bar; every bar has a tooltip with its count.
    expect(panels[0]!.querySelectorAll('rect.bar')).toHaveLength(2);
    expect(panels[0]!.querySelector('title')?.textContent).toBe('2025-01: 3 comments');

    const brand = screen.getByRole('region', { name: 'By brand' });
    const rows = within(brand).getAllByRole('row');
    expect(rows[1]).toHaveTextContent(/Examplin\s*42–6/);
    const fn = screen.getByRole('region', { name: 'By reviewer function' });
    expect(within(fn).getByRole('rowheader', { name: 'Legal' })).toBeInTheDocument();

    const cands = screen.getByRole('region', { name: 'Candidate new rules' });
    expect(
      within(cands).getByRole('heading', { name: /Image rights · 3 comments/ }),
    ).toBeInTheDocument();
    expect(within(cands).getByText(/licensing rights for this stock photo/)).toBeInTheDocument();
    expect(within(cands).getByText(/3 of 3 comments with no matching rule/)).toBeInTheDocument();
  });

  it('switches the over-time view to a table', async () => {
    mockApi(
      ...people(),
      route('GET', '/api/precedents/trends', () => ({ body: trends() })),
      route('GET', '/api/precedents/candidates', () => ({ body: candidates })),
    );
    const user = userEvent.setup();
    renderApp('/precedents');
    await user.click(await screen.findByRole('button', { name: 'Show table' }));
    const table = screen.getByRole('table', { name: 'Comments per month by category' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent(/2025-01\s*32–5/);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('sends filters to both endpoints and keeps them in the URL', async () => {
    const calls = mockApi(
      ...people(),
      route('GET', '/api/precedents/trends', () => ({ body: trends() })),
      route('GET', '/api/precedents/candidates', () => ({ body: candidates })),
    );
    const user = userEvent.setup();
    renderApp('/precedents?function=legal');
    await screen.findByRole('option', { name: 'Fictorex' });
    await user.selectOptions(screen.getByLabelText('Brand'), 'Fictorex');
    await user.selectOptions(screen.getByLabelText('Group by'), 'quarter');
    expect(screen.getByLabelText('Reviewer function')).toHaveValue('legal');

    await waitFor(() => {
      const fetches = (vi.mocked(fetch).mock.calls as [string][]).map(([u]) => u);
      expect(fetches).toContain(
        '/api/precedents/trends?brand=Fictorex&reviewerFunction=legal&interval=quarter',
      );
      expect(fetches).toContain('/api/precedents/candidates?brand=Fictorex&reviewerFunction=legal');
    });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByLabelText('Brand')).toHaveValue(''));
  });

  it('explains how to import when there are no comments', async () => {
    mockApi(
      ...people(),
      route('GET', '/api/precedents/trends', () => ({
        body: trends({
          totals: { comments: 0, classified: 0, noMatchingRule: 0, unclassified: 0 },
          overTime: [],
          byCategory: [],
          byBrand: [],
          byReviewerFunction: [],
          filterOptions: { brands: [], reviewerFunctions: [], firstDate: null, lastDate: null },
          classifiers: [],
        }),
      })),
      route('GET', '/api/precedents/candidates', () => ({
        body: { noMatchTotal: 0, clustered: 0, candidates: [] },
      })),
    );
    renderApp('/precedents');
    expect(await screen.findByText(/No historic comments have been imported/)).toBeInTheDocument();
    expect(screen.getByText(/precedent:import/)).toBeInTheDocument();
  });

  it('shows an error when trends fail to load', async () => {
    mockApi(
      ...people(),
      route('GET', '/api/precedents/trends', () => ({ status: 400, body: { error: 'Bad query' } })),
      route('GET', '/api/precedents/candidates', () => ({ body: candidates })),
    );
    renderApp('/precedents');
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent('Bad query');
  });

  it('lists rule candidates and lets rule admins promote a recurring theme', async () => {
    const calls = mockApi(
      ...people('rule_admin', [ruleCandidate]),
      route('GET', '/api/precedents/trends', () => ({ body: trends() })),
      route('GET', '/api/precedents/candidates', () => ({ body: candidates })),
      route('POST', '/api/rule-candidates', (c) => ({
        status: 201,
        body: { ...ruleCandidate, id: 'rc2', ...(c.body as object) },
      })),
    );
    const user = userEvent.setup();
    renderApp('/precedents');
    const list = await screen.findByRole('region', { name: 'Rule candidates' });
    expect(
      await within(list).findByRole('heading', { name: 'Confirm image licensing' }),
    ).toBeInTheDocument();
    expect(
      within(list).getByText(/Proposed by Robin Admin on 2026-10-04 · 3 source comments/),
    ).toBeInTheDocument();
    expect(within(list).getByText('Legal keeps raising this.')).toBeInTheDocument();

    const themes = screen.getByRole('region', { name: 'Candidate new rules' });
    await user.click(
      await within(themes).findByRole('button', { name: 'Promote to rule candidate' }),
    );
    expect(within(themes).getByLabelText('Working title for the proposed rule')).toHaveValue(
      'Image rights',
    );
    await user.click(within(themes).getByRole('button', { name: 'Propose' }));
    expect(await within(themes).findByText('Proposed as a rule candidate.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      title: 'Image rights',
      precedentIds: ['p1', 'p2', 'p3'],
    });
    // The list is refreshed after proposing.
    await waitFor(() =>
      expect(
        calls.filter((c) => c.path === '/api/rule-candidates' && c.method === 'GET'),
      ).toHaveLength(2),
    );
  });

  it('hides the promote action from authors', async () => {
    const calls = mockApi(
      ...people(),
      route('GET', '/api/precedents/trends', () => ({ body: trends() })),
      route('GET', '/api/precedents/candidates', () => ({ body: candidates })),
    );
    renderApp('/precedents');
    await screen.findByText(/licensing rights for this stock photo/);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/me')).toBe(true));
    expect(screen.queryByRole('button', { name: 'Promote to rule candidate' })).toBeNull();
    expect(await screen.findByText('No rule candidates yet.')).toBeInTheDocument();
  });
});
