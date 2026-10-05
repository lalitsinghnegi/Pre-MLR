import { vi } from 'vitest';
import type { FindingView, Me, RuleSummary, RuleVersion, ScanSummary } from '@pre-mlr/shared';

export interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

type Handler = (call: Call) => { status?: number; body: unknown } | undefined;

export const signedIn = (o: Partial<Me> = {}): Me => ({
  id: 'u1',
  name: 'Pat Reviewer',
  role: 'author',
  ...o,
});

/** Used after a test's own handlers: a signed-in author, and no rules. */
const DEFAULTS: Handler[] = [
  (c) => (c.method === 'GET' && c.path === '/api/me' ? { body: { user: signedIn() } } : undefined),
  (c) => (c.method === 'GET' && c.path === '/api/rules' ? { body: [] } : undefined),
  (c) =>
    c.method === 'GET' && /^\/api\/scans\/[^/]+\/rules$/.test(c.path) ? { body: [] } : undefined,
];

/**
 * Stubs fetch with a list of handlers (first non-undefined wins, then the defaults above) and
 * records every call.
 */
export function mockApi(...handlers: Handler[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://localhost');
      const call: Call = {
        method: init.method ?? 'GET',
        path: url.pathname,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: new Headers(init.headers),
      };
      calls.push(call);
      for (const h of [...handlers, ...DEFAULTS]) {
        const res = h(call);
        if (res) {
          // 204/205/304 responses can't carry a body.
          const empty = [204, 205, 304].includes(res.status ?? 200);
          return new Response(empty ? null : JSON.stringify(res.body), {
            status: res.status ?? 200,
          });
        }
      }
      return new Response(JSON.stringify({ error: `no mock for ${call.method} ${call.path}` }), {
        status: 500,
      });
    }),
  );
  return calls;
}

export const route =
  (
    method: string,
    path: string | RegExp,
    respond: (call: Call) => { status?: number; body: unknown },
  ): Handler =>
  (call) =>
    call.method === method && (typeof path === 'string' ? call.path === path : path.test(call.path))
      ? respond(call)
      : undefined;

export const scan = (o: Partial<ScanSummary> = {}): ScanSummary => ({
  id: 's1',
  startUrl: 'https://examplin.test/',
  maxPages: 25,
  maxDepth: 3,
  status: 'completed',
  phase: null,
  error: null,
  pagesCrawled: 3,
  product: null,
  createdBy: 'Pat Reviewer',
  createdAt: '2026-10-03T10:00:00.000Z',
  startedAt: '2026-10-03T10:00:01.000Z',
  finishedAt: '2026-10-03T10:01:00.000Z',
  findings: {
    total: 3,
    byStatus: { open: 3, accepted: 0, rejected: 0, edited: 0 },
    openBySeverity: { critical: 1, major: 1, minor: 1, info: 0 },
  },
  ...o,
});

let n = 0;
export function finding(
  o: Partial<FindingView> & { pageNumber?: number | null } = {},
): FindingView {
  const { pageNumber = 1, ...rest } = o;
  n += 1;
  return {
    id: `f${n}`,
    scanId: 's1',
    pageId: pageNumber === null ? null : `p${pageNumber}`,
    ruleId: 'superlatives',
    ruleVersion: 1,
    detectedBy: 'rules_engine',
    severity: 'major',
    message: 'Absolute or superlative language: "best".',
    evidenceText: 'Examplin is the best inhaler.',
    evidenceLocation: { view: 'desktop', x: 100, y: 200, width: 400, height: 50 },
    evidenceCropPath: null,
    suggestedFix: 'Rephrase without this language.',
    editedFix: null,
    confidence: null,
    status: 'open',
    authorComment: null,
    revision: 1,
    createdAt: '2026-10-03T10:01:00.000Z',
    updatedAt: '2026-10-03T10:01:00.000Z',
    updatedBy: 'rules_engine',
    page:
      pageNumber === null
        ? null
        : {
            id: `p${pageNumber}`,
            number: pageNumber,
            url: `https://examplin.test/${pageNumber === 1 ? '' : `page-${pageNumber}`}`,
            title: `Page ${pageNumber}`,
            screenshots: { desktop: true, mobile: true },
            tip: null,
          },
    rule: {
      title: 'No unsupported absolute or superlative language',
      category: 'claims',
      description: 'Absolute terms need substantial evidence.',
      sourceCitation: '21 CFR 202.1(e)(6)(i)',
      sourceUrl: 'https://www.law.cornell.edu/cfr/text/21/202.1',
      sourceNote: null,
    },
    precedents: [],
    ...rest,
  };
}

export const ruleVersion = (o: Partial<RuleVersion> = {}): RuleVersion => ({
  ruleId: 'superlatives',
  version: 1,
  title: 'No unsupported absolute or superlative language',
  description: 'Absolute terms need substantial evidence.',
  category: 'claims',
  severity: 'major',
  checkType: 'deterministic',
  sourceCitation: '21 CFR 202.1(e)(6)(i)',
  sourceUrl: 'https://www.law.cornell.edu/cfr/text/21/202.1',
  sourceNote: null,
  lastVerified: '2026-10-03',
  promptTemplate: null,
  params: { check: 'phrase-list', label: 'Superlatives', phrases: ['best', 'safest'] },
  enabledByDefault: true,
  origin: 'pack:public@1.0',
  contentHash: 'h1',
  createdAt: '2026-10-03T10:00:00.000Z',
  createdBy: 'rule-pack-loader',
  ...o,
});

export const ruleSummary = (o: Partial<RuleSummary> = {}): RuleSummary => ({
  ruleId: o.latest?.ruleId ?? 'superlatives',
  latest: ruleVersion(),
  versionCount: 1,
  retiredAt: null,
  scans: 2,
  findings: 5,
  ...o,
});
