import { z } from 'zod';
import {
  AuditEntrySchema,
  CandidateRulesSchema,
  FindingViewSchema,
  HealthResponseSchema,
  MeSchema,
  PrecedentTrendsSchema,
  RuleCandidateSchema,
  RuleDetailSchema,
  RuleSummarySchema,
  ScanRuleSchema,
  SessionSchema,
  ScanSchema,
  ScanSummarySchema,
  type BulkFindingUpdate,
  type CandidateRulesQuery,
  type CreateRule,
  type CreateRuleCandidate,
  type LoginRequest,
  type Me,
  type NewRuleVersion,
  type CreateScanRequest,
  type FindingUpdate,
  type FindingView,
  type TrendsQuery,
} from '@pre-mlr/shared';

// Empty in dev: requests go to /api on the Vite server, which proxies to the backend.
export const API_BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  // The session cookie identifies the user; "include" also sends it when VITE_API_URL is another origin.
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body as { error?: string } | null)?.error ?? `Request failed: HTTP ${res.status}`;
    throw new ApiError(res.status, message, body);
  }
  return schema.parse(body);
}

/** "?a=1&b=2" from the defined, non-empty values (or ""). */
function query(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const api = {
  health: (signal?: AbortSignal) => request('/api/health', HealthResponseSchema, { signal }),
  listScans: () => request('/api/scans', ScanSummarySchema.array()),
  getScan: (id: string) => request(`/api/scans/${encodeURIComponent(id)}`, ScanSchema),
  createScan: (body: CreateScanRequest) => request('/api/scans', ScanSchema, json('POST', body)),
  rerunScan: (id: string) =>
    request(`/api/scans/${encodeURIComponent(id)}/rerun`, ScanSchema, { method: 'POST' }),
  deleteScan: (id: string) =>
    request(`/api/scans/${encodeURIComponent(id)}`, z.unknown(), { method: 'DELETE' }),
  listFindings: (scanId: string) =>
    request(`/api/scans/${encodeURIComponent(scanId)}/findings`, FindingViewSchema.array()),
  updateFinding: (id: string, update: FindingUpdate) =>
    request(`/api/findings/${encodeURIComponent(id)}`, FindingViewSchema, json('PATCH', update)),
  bulkUpdate: (body: BulkFindingUpdate) =>
    request('/api/findings/bulk', FindingViewSchema.array(), json('POST', body)),
  audit: (findingId: string) =>
    request(`/api/findings/${encodeURIComponent(findingId)}/audit`, AuditEntrySchema.array()),
  precedentTrends: (q: TrendsQuery) =>
    request(`/api/precedents/trends${query(q)}`, PrecedentTrendsSchema),
  candidateRules: (q: CandidateRulesQuery) =>
    request(`/api/precedents/candidates${query(q)}`, CandidateRulesSchema),
  /** The signed-in user, or null when signed out. */
  me: async (): Promise<Me | null> => (await request('/api/me', SessionSchema)).user,
  login: (body: LoginRequest) => request('/api/auth/login', MeSchema, json('POST', body)),
  logout: () => request('/api/auth/logout', z.unknown(), { method: 'POST' }),
  rules: () => request('/api/rules', RuleSummarySchema.array()),
  rule: (id: string) => request(`/api/rules/${encodeURIComponent(id)}`, RuleDetailSchema),
  ruleAudit: (id: string) =>
    request(`/api/rules/${encodeURIComponent(id)}/audit`, AuditEntrySchema.array()),
  createRule: (body: CreateRule) => request('/api/rules', RuleDetailSchema, json('POST', body)),
  addRuleVersion: (id: string, body: NewRuleVersion) =>
    request(`/api/rules/${encodeURIComponent(id)}/versions`, RuleDetailSchema, json('POST', body)),
  setRetired: (id: string, retired: boolean) =>
    request(
      `/api/rules/${encodeURIComponent(id)}/${retired ? 'retire' : 'restore'}`,
      RuleDetailSchema,
      {
        method: 'POST',
      },
    ),
  scanRules: (scanId: string) =>
    request(`/api/scans/${encodeURIComponent(scanId)}/rules`, ScanRuleSchema.array()),
  ruleCandidates: () => request('/api/rule-candidates', RuleCandidateSchema.array()),
  createRuleCandidate: (body: CreateRuleCandidate) =>
    request('/api/rule-candidates', RuleCandidateSchema, json('POST', body)),
};

export const urls = {
  ruleYaml: (id: string, version: number) =>
    `${API_BASE}/api/rules/${encodeURIComponent(id)}/versions/${version}/yaml`,
  report: (scanId: string) => `${API_BASE}/api/scans/${encodeURIComponent(scanId)}/report.pdf`,
  sitemap: (scanId: string) => `${API_BASE}/api/scans/${encodeURIComponent(scanId)}/sitemap.svg`,
  screenshot: (scanId: string, pageId: string, view: 'desktop' | 'mobile') =>
    `${API_BASE}/api/scans/${encodeURIComponent(scanId)}/pages/${encodeURIComponent(pageId)}/screenshot/${view}`,
};

/** The server's current copy of a finding, sent with a 409 conflict. */
export function conflictCurrent(err: unknown): FindingView[] {
  if (!(err instanceof ApiError) || err.status !== 409) return [];
  const current = (err.body as { current?: unknown } | null)?.current;
  const parsed = FindingViewSchema.array().safeParse(Array.isArray(current) ? current : [current]);
  return parsed.success ? parsed.data : [];
}

// Kept for the home page's backend status line.
export const getHealth = api.health;
