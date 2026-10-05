import {
  keepPreviousData,
  MutationCache,
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  BulkFindingUpdate,
  CandidateRulesQuery,
  CreateRule,
  CreateRuleCandidate,
  LoginRequest,
  NewRuleVersion,
  CreateScanRequest,
  FindingUpdate,
  FindingView,
  Scan,
  ScanSummary,
  TrendsQuery,
} from '@pre-mlr/shared';
import { api, ApiError, conflictCurrent } from './client';

export function createQueryClient(): QueryClient {
  // Any 401 means the session ended (expired, signed out elsewhere): re-check who is signed in,
  // which shows the sign-in page.
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      void client.invalidateQueries({ queryKey: keys.me });
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 1,
        refetchOnWindowFocus: false,
      },
    },
  });
  return client;
}

const isActive = (s: Pick<Scan, 'status'>) => s.status === 'queued' || s.status === 'running';
const POLL_MS = 2000;

export const keys = {
  scans: ['scans'] as const,
  scan: (id: string) => ['scan', id] as const,
  findings: (id: string) => ['findings', id] as const,
  audit: (id: string) => ['audit', id] as const,
  trends: (q: TrendsQuery) => ['precedent-trends', q] as const,
  candidates: (q: CandidateRulesQuery) => ['precedent-candidates', q] as const,
  me: ['me'] as const,
  ruleCandidates: ['rule-candidates'] as const,
  rules: ['rules'] as const,
  rule: (id: string) => ['rule', id] as const,
  ruleAudit: (id: string) => ['rule-audit', id] as const,
  scanRules: (id: string) => ['scan-rules', id] as const,
};

/** The signed-in user (null when signed out). */
export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: 5 * 60_000 });
}

/** Whether to show rule-admin actions (the server checks again on every request). */
export const useIsRuleAdmin = () => useMe().data?.role === 'rule_admin';

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api.login(body),
    onSuccess: (me) => {
      // Drop anything fetched as someone else (or while signed out), then mark who is signed in.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
      qc.setQueryData(keys.me, me);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
      qc.setQueryData(keys.me, null);
    },
  });
}

export function useRules() {
  return useQuery({ queryKey: keys.rules, queryFn: api.rules });
}

export function useRule(id: string) {
  return useQuery({ queryKey: keys.rule(id), queryFn: () => api.rule(id) });
}

export function useRuleAudit(id: string) {
  return useQuery({ queryKey: keys.ruleAudit(id), queryFn: () => api.ruleAudit(id) });
}

export function useScanRules(scanId: string) {
  return useQuery({ queryKey: keys.scanRules(scanId), queryFn: () => api.scanRules(scanId) });
}

/** After any rule change: refresh the list, the rule and its history. */
function useRuleChanged() {
  const qc = useQueryClient();
  return (id: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.rules }),
      qc.invalidateQueries({ queryKey: keys.rule(id) }),
      qc.invalidateQueries({ queryKey: keys.ruleAudit(id) }),
    ]);
}

export function useCreateRule() {
  const changed = useRuleChanged();
  return useMutation({
    mutationFn: (body: CreateRule) => api.createRule(body),
    onSuccess: (d) => changed(d.ruleId),
  });
}

export function useAddRuleVersion(id: string) {
  const changed = useRuleChanged();
  return useMutation({
    mutationFn: (body: NewRuleVersion) => api.addRuleVersion(id, body),
    onSuccess: () => changed(id),
  });
}

export function useSetRetired(id: string) {
  const changed = useRuleChanged();
  return useMutation({
    mutationFn: (retired: boolean) => api.setRetired(id, retired),
    onSuccess: () => changed(id),
  });
}

export function useRuleCandidates() {
  return useQuery({ queryKey: keys.ruleCandidates, queryFn: api.ruleCandidates });
}

export function useCreateRuleCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRuleCandidate) => api.createRuleCandidate(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.ruleCandidates }),
  });
}

/** Keeps showing the previous result while a new filter loads (no flash of empty charts). */
export function usePrecedentTrends(q: TrendsQuery) {
  return useQuery({
    queryKey: keys.trends(q),
    queryFn: () => api.precedentTrends(q),
    placeholderData: keepPreviousData,
  });
}

export function useCandidateRules(q: CandidateRulesQuery) {
  return useQuery({
    queryKey: keys.candidates(q),
    queryFn: () => api.candidateRules(q),
    placeholderData: keepPreviousData,
  });
}

export function useScans() {
  return useQuery({
    queryKey: keys.scans,
    queryFn: api.listScans,
    refetchInterval: (q) => (q.state.data?.some(isActive) ? POLL_MS : false),
  });
}

export function useScan(id: string) {
  return useQuery({
    queryKey: keys.scan(id),
    queryFn: () => api.getScan(id),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data) ? POLL_MS : false),
  });
}

/** Findings are written when a scan's checks finish, so refetch whenever the scan status changes. */
export function useFindings(scanId: string, scanStatus: Scan['status'] | undefined) {
  return useQuery({
    queryKey: [...keys.findings(scanId), scanStatus],
    queryFn: () => api.listFindings(scanId),
    enabled: scanStatus !== undefined,
  });
}

export function useAudit(findingId: string | null) {
  return useQuery({
    queryKey: keys.audit(findingId ?? ''),
    queryFn: () => api.audit(findingId!),
    enabled: !!findingId,
  });
}

export function useCreateScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateScanRequest) => api.createScan(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.scans }),
  });
}

/** Replace findings in every cached findings list for the scan, and refresh their audit history. */
function useApplyFindings(scanId: string) {
  const qc = useQueryClient();
  return (updated: FindingView[]) => {
    if (!updated.length) return;
    const byId = new Map(updated.map((f) => [f.id, f]));
    qc.setQueriesData<FindingView[]>({ queryKey: keys.findings(scanId) }, (list) =>
      list?.map((f) => byId.get(f.id) ?? f),
    );
    for (const f of updated) void qc.invalidateQueries({ queryKey: keys.audit(f.id) });
    qc.setQueryData<ScanSummary[]>(keys.scans, undefined); // counts changed; refetch when shown
  };
}

/** On 409 the server's current copy is applied too, so the grid shows what changed. */
/** Starts a new scan with the same settings; the list refreshes. */
export function useRerunScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.rerunScan(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.scans }),
  });
}

export function useDeleteScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteScan(id),
    onSuccess: (_r, id) => {
      qc.setQueryData<ScanSummary[]>(keys.scans, (list) => list?.filter((s) => s.id !== id));
      qc.removeQueries({ queryKey: keys.scan(id) });
      qc.removeQueries({ queryKey: keys.findings(id) });
      return qc.invalidateQueries({ queryKey: keys.scans });
    },
  });
}

export function useUpdateFinding(scanId: string) {
  const apply = useApplyFindings(scanId);
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: FindingUpdate }) =>
      api.updateFinding(id, update),
    onSuccess: (f) => apply([f]),
    onError: (err) => apply(conflictCurrent(err)),
  });
}

export function useBulkUpdate(scanId: string) {
  const apply = useApplyFindings(scanId);
  return useMutation({
    mutationFn: (body: BulkFindingUpdate) => api.bulkUpdate(body),
    onSuccess: apply,
    onError: (err) => apply(conflictCurrent(err)),
  });
}
