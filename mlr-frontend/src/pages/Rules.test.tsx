import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuleDetail } from '@pre-mlr/shared';
import { mockApi, route, ruleSummary, ruleVersion, signedIn } from '../test/api';
import { renderApp } from '../test/render';

afterEach(() => vi.unstubAllGlobals());

const admin = () =>
  route('GET', '/api/me', () => ({ body: { user: signedIn({ role: 'rule_admin' }) } }));

const v1 = ruleVersion();
const v2 = ruleVersion({
  version: 2,
  title: 'No unsupported superlatives',
  params: { check: 'phrase-list', label: 'Superlatives', phrases: ['best'] },
  origin: 'admin',
  createdBy: 'Robin Admin',
  createdAt: '2026-10-04T09:00:00.000Z',
  contentHash: 'h2',
});
const detail = (o: Partial<RuleDetail> = {}): RuleDetail => ({
  ruleId: 'superlatives',
  createdAt: v1.createdAt,
  retiredAt: null,
  versions: [
    {
      ...v2,
      scans: 1,
      findings: 0,
      changes: [
        { field: 'title', from: v1.title, to: v2.title },
        { field: 'params', from: v1.params, to: v2.params },
      ],
    },
    { ...v1, scans: 1, findings: 3, changes: [] },
  ],
  usage: [
    {
      scanId: 's9',
      startUrl: 'https://examplin.test/',
      createdAt: '2026-10-03T11:00:00.000Z',
      version: 1,
      enabled: true,
      findings: 3,
    },
  ],
  ...o,
});
const ruleRoutes = (d = detail()) => [
  route('GET', '/api/rules/superlatives', () => ({ body: d })),
  route('GET', '/api/rules/superlatives/audit', () => ({ body: [] })),
];

describe('rule list', () => {
  it('lists current rules with filters; retired ones on request; New rule only for admins', async () => {
    const list = [
      ruleSummary(),
      ruleSummary({
        latest: ruleVersion({
          ruleId: 'alt-text',
          title: 'Images have alt text',
          category: 'accessibility',
          severity: 'minor',
        }),
      }),
      ruleSummary({
        latest: ruleVersion({ ruleId: 'old-rule', title: 'An old rule' }),
        retiredAt: '2026-10-01T00:00:00.000Z',
      }),
    ];
    mockApi(route('GET', '/api/rules', () => ({ body: list })));
    const user = userEvent.setup();
    renderApp('/rules');
    const table = await screen.findByRole('table');
    const titles = () =>
      within(table)
        .getAllByRole('link')
        .map((l) => l.textContent);
    expect(titles()).toEqual([
      'No unsupported absolute or superlative language',
      'Images have alt text',
    ]);
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent(
      /ClaimsMajorRules engineYesv1rule pack public@1.025/,
    );
    expect(screen.queryByRole('link', { name: 'New rule' })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Category'), 'accessibility');
    expect(titles()).toEqual(['Images have alt text']);
    await user.selectOptions(screen.getByLabelText('Category'), '');
    await user.click(screen.getByLabelText('Show retired rules'));
    expect(titles()).toContain('An old rule');
    await user.type(screen.getByLabelText('Search'), 'old-');
    expect(titles()).toEqual(['An old rule']);
  });

  it('shows New rule to rule admins', async () => {
    mockApi(
      admin(),
      route('GET', '/api/rules', () => ({ body: [ruleSummary()] })),
    );
    renderApp('/rules');
    expect(await screen.findByRole('link', { name: 'New rule' })).toHaveAttribute(
      'href',
      '/rules/new',
    );
  });
});

describe('rule detail', () => {
  it('shows the versions with their changes, usage and downloads; no admin actions for authors', async () => {
    mockApi(...ruleRoutes());
    renderApp('/rules/superlatives');
    expect(
      await screen.findByRole('heading', { name: 'No unsupported superlatives' }),
    ).toBeInTheDocument();
    const versions = screen.getByRole('region', { name: 'Versions' });
    const items = within(versions)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement?.classList.contains('versions'));
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/v2.*Robin Admin · edited in the app · 1 scan, 0 findings/);
    expect(within(items[0]!).getByText('Title:').parentElement).toHaveTextContent(
      'Title: No unsupported absolute or superlative language → No unsupported superlatives',
    );
    // Settings show as a line diff: only "- safest" went away.
    const diff = within(items[0]!).getByLabelText('Changes');
    expect(diff.querySelectorAll('.diff-removed')).toHaveLength(1);
    expect(diff.querySelector('.diff-removed')).toHaveTextContent('Removed: - - safest');
    expect(diff.querySelectorAll('.diff-added')).toHaveLength(0);
    expect(within(items[1]!).getByRole('link', { name: 'Download YAML' })).toHaveAttribute(
      'href',
      '/api/rules/superlatives/versions/1/yaml',
    );
    const usage = screen.getByRole('region', { name: 'Scans that used this rule' });
    expect(within(usage).getByRole('link', { name: 'examplin.test' })).toHaveAttribute(
      'href',
      '/scans/s9',
    );
    expect(within(usage).getAllByRole('row')[1]).toHaveTextContent(/v1Yes3$/);
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retire/ })).toBeNull();
  });

  it('shows an older version when linked from a finding', async () => {
    mockApi(...ruleRoutes());
    renderApp('/rules/superlatives?version=1');
    expect(
      await screen.findByRole('heading', {
        name: 'No unsupported absolute or superlative language',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/version 1/)).toHaveTextContent(
      'superlatives · version 1 (latest is v2)',
    );
    expect(screen.getByLabelText('Rule details')).toHaveTextContent('- safest');
  });

  it('lets an admin retire a rule after confirming', async () => {
    const calls = mockApi(
      admin(),
      ...ruleRoutes(),
      route('POST', '/api/rules/superlatives/retire', () => ({
        body: detail({ retiredAt: '2026-10-04T10:00:00.000Z' }),
      })),
    );
    const user = userEvent.setup();
    renderApp('/rules/superlatives');
    expect(await screen.findByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/rules/superlatives/edit',
    );
    await user.click(screen.getByRole('button', { name: 'Retire…' }));
    expect(screen.getByRole('group', { name: 'Confirm retire' })).toHaveTextContent(
      /New scans will leave this rule out/,
    );
    await user.click(screen.getByRole('button', { name: 'Retire rule' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/retire'))).toBe(true),
    );
  });
});

describe('rule editing', () => {
  it('saves an edit as a new version with the YAML settings parsed', async () => {
    const calls = mockApi(
      admin(),
      ...ruleRoutes(),
      route('POST', '/api/rules/superlatives/versions', () => ({ status: 201, body: detail() })),
    );
    const user = userEvent.setup();
    renderApp('/rules/superlatives/edit');
    expect(
      await screen.findByRole('heading', {
        name: /Edit No unsupported superlatives \(saves version 3\)/,
      }),
    ).toBeInTheDocument();
    const title = screen.getByLabelText('Title');
    expect(title).toHaveValue('No unsupported superlatives');
    await user.clear(title);
    await user.type(title, 'Avoid superlatives');
    const yaml = screen.getByLabelText('Settings (YAML)');
    await user.clear(yaml);
    await user.type(yaml, 'check: phrase-list{enter}label: Words{enter}phrases: [[best, finest]');

    await user.click(screen.getByRole('button', { name: 'Save new version' }));
    await screen.findByRole('heading', { name: 'No unsupported superlatives' }); // back on detail
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({
      title: 'Avoid superlatives',
      description: v2.description,
      category: 'claims',
      severity: 'major',
      checkType: 'deterministic',
      enabledByDefault: true,
      sourceCitation: v2.sourceCitation,
      sourceUrl: v2.sourceUrl,
      sourceNote: null,
      lastVerified: '2026-10-03',
      promptTemplate: null,
      params: { check: 'phrase-list', label: 'Words', phrases: ['best', 'finest'] },
      expectedLatestVersion: 2,
    });
  });

  it('catches invalid YAML before sending, and explains a conflicting save', async () => {
    const calls = mockApi(
      admin(),
      ...ruleRoutes(),
      route('POST', '/api/rules/superlatives/versions', () => ({
        status: 409,
        body: {
          error: 'Rule superlatives was changed by Sam (now version 3); reload and edit again.',
        },
      })),
    );
    const user = userEvent.setup();
    renderApp('/rules/superlatives/edit');
    const yaml = await screen.findByLabelText('Settings (YAML)');
    await user.clear(yaml);
    await user.type(yaml, '- just a list');
    await user.click(screen.getByRole('button', { name: 'Save new version' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Settings must be a YAML mapping');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await user.clear(yaml);
    await user.type(yaml, 'check: phrase-list');
    await user.click(screen.getByRole('button', { name: 'Save new version' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('changed by Sam (now version 3)');
    expect(within(alert).getByRole('link', { name: 'Open the latest version' })).toHaveAttribute(
      'href',
      '/rules/superlatives',
    );
  });

  it('creates a rule, asking for a prompt only for AI rules', async () => {
    const calls = mockApi(
      admin(),
      route('POST', '/api/rules', () => ({
        status: 201,
        body: detail({ ruleId: 'no-miracles' }),
      })),
      route('GET', '/api/rules/no-miracles', () => ({ body: detail({ ruleId: 'no-miracles' }) })),
      route('GET', '/api/rules/no-miracles/audit', () => ({ body: [] })),
    );
    const user = userEvent.setup();
    renderApp('/rules/new');
    await user.type(await screen.findByLabelText('Rule id'), 'no-miracles');
    await user.type(screen.getByLabelText('Title'), 'No miracle claims');
    await user.type(screen.getByLabelText('Description'), 'Miracle wording overstates.');
    await user.type(screen.getByLabelText('Source citation'), '21 CFR 202.1');
    expect(screen.queryByLabelText('Prompt template')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Check'), 'llm');
    await user.type(screen.getByLabelText('Prompt template'), 'Flag miracle wording.');
    await user.clear(screen.getByLabelText('Settings (YAML)'));
    await user.click(screen.getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      ruleId: 'no-miracles',
      checkType: 'llm',
      promptTemplate: 'Flag miracle wording.',
      params: {},
      sourceUrl: null,
    });
  });

  it('tells authors that only rule admins can edit', async () => {
    mockApi();
    renderApp('/rules/new');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only rule admins can create or edit rules.',
    );
  });
});
