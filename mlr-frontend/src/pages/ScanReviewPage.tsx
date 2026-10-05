import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { FindingStatus, FindingUpdate, FindingView } from '@pre-mlr/shared';
import { ApiError, urls } from '../api/client';
import { useBulkUpdate, useFindings, useScan, useUpdateFinding } from '../api/queries';
import { FilterBar } from '../components/review/FilterBar';
import {
  FindingDialog,
  type DialogResult,
  type DialogState,
} from '../components/review/FindingDialog';
import { FindingPreview } from '../components/review/FindingPreview';
import { ScanRulesPanel } from '../components/review/ScanRulesPanel';
import {
  FindingsGrid,
  type FindingAction,
  type GridContext,
} from '../components/review/FindingsGrid';
import {
  EMPTY_FILTERS,
  STATUS_LABEL,
  applyFilters,
  buildRows,
  pageLabel,
  type Filters,
} from '../review/model';

export function ScanReviewPage() {
  const { id = '' } = useParams();
  const scan = useScan(id);
  const findingsQuery = useFindings(id, scan.data?.status);
  const update = useUpdateFinding(id);
  const bulk = useBulkUpdate(id);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const all = useMemo(() => findingsQuery.data ?? [], [findingsQuery.data]);
  const filtered = useMemo(() => applyFilters(all, filters), [all, filters]);
  const rows = useMemo(
    () => buildRows(filtered, grouped, collapsed),
    [filtered, grouped, collapsed],
  );
  const focused = all.find((f) => f.id === focusedId);
  const selectedFindings = all.filter((f) => selected.includes(f.id));

  const { mutateAsync: updateAsync } = update;
  const save = useCallback(
    async (f: FindingView, change: Omit<FindingUpdate, 'expectedRevision'>, done: string) => {
      try {
        await updateAsync({ id: f.id, update: { ...change, expectedRevision: f.revision } });
        setAnnouncement(`${done}: ${f.rule.title} on ${pageLabel(f)}.`);
      } catch (err) {
        setAnnouncement(failureMessage(err, `${f.rule.title} on ${pageLabel(f)}`));
      }
    },
    [updateAsync],
  );

  const onAction = useCallback(
    (action: FindingAction, f: FindingView) => {
      setFocusedId(f.id);
      if (action === 'accept') void save(f, { status: 'accepted' }, 'Accepted');
      else if (action === 'reject') void save(f, { status: 'rejected' }, 'Rejected');
      else if (action === 'reopen') void save(f, { status: 'open' }, 'Reopened');
      else setDialog({ kind: action, finding: f });
    },
    [save],
  );

  const context = useMemo<GridContext>(
    () => ({
      onAction,
      onToggleGroup: (key) =>
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        }),
    }),
    [onAction],
  );

  const onBulk = (status: Exclude<FindingStatus, 'edited'>) =>
    setDialog({ kind: 'bulk', status, count: selectedFindings.length });

  const onDialogSubmit = async (result: DialogResult) => {
    if (!dialog) return;
    if (dialog.kind === 'bulk') {
      try {
        const items = selectedFindings.map((f) => ({ id: f.id, expectedRevision: f.revision }));
        await bulk.mutateAsync({
          items,
          status: dialog.status,
          ...(result.comment ? { comment: result.comment } : {}),
        });
        setAnnouncement(
          `${STATUS_LABEL[dialog.status]} ${items.length} finding${items.length === 1 ? '' : 's'}.`,
        );
      } catch (err) {
        setAnnouncement(failureMessage(err));
      }
      setDialog(null);
      return;
    }
    // On failure the message explains why, and a conflict has already refreshed the row.
    if (dialog.kind === 'edit') {
      await save(
        dialog.finding,
        { editedFix: result.editedFix, comment: result.comment },
        'Fix edited',
      );
    } else {
      await save(dialog.finding, { comment: result.comment ?? null }, 'Comment saved');
    }
    setDialog(null);
  };

  if (scan.isLoading) return <p>Loading scan…</p>;
  if (scan.error)
    return (
      <p role="alert" className="error">
        Could not load scan: {scan.error.message}
      </p>
    );
  const s = scan.data!;
  const open = all.filter((f) => f.status === 'open').length;

  return (
    <div className="review">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Scans</Link> <span aria-hidden="true">›</span> {new URL(s.startUrl).host}
      </nav>
      <header className="review-header">
        <div>
          <h1>Review: {new URL(s.startUrl).host}</h1>
          <p className="muted">
            {s.startUrl} · {s.pagesCrawled} pages ·{' '}
            <span className={`badge scan-${s.status}`}>{s.status}</span>
            {s.status === 'completed' && ` · ${open} of ${all.length} findings open`}
          </p>
        </div>
        {s.status === 'completed' && (
          <div className="header-actions">
            <a className="btn" href={urls.sitemap(s.id)} target="_blank" rel="noreferrer">
              Site map
            </a>
            <a className="btn primary" href={urls.report(s.id)}>
              Download PDF
            </a>
          </div>
        )}
      </header>

      {s.status !== 'queued' && <ScanRulesPanel scanId={s.id} />}

      <div role="status" aria-live="polite" className="announcer">
        {announcement}
      </div>

      {s.status === 'queued' || s.status === 'running' ? (
        <p className="card">
          Scan {s.status}
          {s.phase ? ` (${PHASE_LABEL[s.phase]})` : ''}… {s.pagesCrawled} of up to {s.maxPages}{' '}
          pages crawled. Findings appear when checks finish.
        </p>
      ) : s.status === 'failed' ? (
        <p role="alert" className="card error">
          Scan failed: {s.error}
        </p>
      ) : findingsQuery.error ? (
        <p role="alert" className="error">
          Could not load findings: {findingsQuery.error.message}
        </p>
      ) : (
        <>
          <FilterBar
            findings={all}
            filters={filters}
            onChange={setFilters}
            grouped={grouped}
            onGroupedChange={setGrouped}
            shown={filtered.length}
          />
          <div className="bulk-bar" aria-label="Bulk actions" role="toolbar">
            <span>{selectedFindings.length} selected</span>
            <button
              type="button"
              className="btn small accept"
              disabled={!selectedFindings.length}
              onClick={() => onBulk('accepted')}
            >
              Accept selected
            </button>
            <button
              type="button"
              className="btn small reject"
              disabled={!selectedFindings.length}
              onClick={() => onBulk('rejected')}
            >
              Reject selected
            </button>
            <button
              type="button"
              className="btn small"
              disabled={!selectedFindings.length}
              onClick={() => onBulk('open')}
            >
              Reopen selected
            </button>
          </div>
          <div className="review-body">
            <FindingsGrid
              rows={rows}
              grouped={grouped}
              context={context}
              onFocusFinding={setFocusedId}
              onSelectionChange={setSelected}
            />
            <FindingPreview scanId={s.id} finding={focused} onAction={onAction} />
          </div>
        </>
      )}

      <FindingDialog
        state={dialog}
        busy={update.isPending || bulk.isPending}
        onSubmit={onDialogSubmit}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

/** For conflicts, name what changed (the server message uses ids) when we know it. */
const PHASE_LABEL = {
  crawling: 'crawling pages',
  checking: 'running rule checks',
  analyzing: 'running AI analysis',
  matching: 'finding similar past comments',
} as const;

function failureMessage(err: unknown, what?: string): string {
  if (err instanceof ApiError && err.status === 409) {
    const head = what ? `Someone else changed "${what}"` : err.message;
    return `${head}. The latest version is now shown; review it and try again.`;
  }
  return `Could not save: ${err instanceof Error ? err.message : String(err)}`;
}
