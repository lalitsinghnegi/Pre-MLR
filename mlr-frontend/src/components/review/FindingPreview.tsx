import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { FindingView } from '@pre-mlr/shared';
import { urls } from '../../api/client';
import { useAudit } from '../../api/queries';
import { CATEGORY_LABEL, STATUS_LABEL, pageLabel } from '../../review/model';
import { SeverityBadge, SourceTag, StatusBadge } from './Badges';
import { SimilarPrecedents } from './SimilarPrecedents';
import type { FindingAction } from './FindingsGrid';

interface Props {
  scanId: string;
  finding: FindingView | undefined;
  onAction: (action: FindingAction, finding: FindingView) => void;
}

export function FindingPreview({ scanId, finding, onAction }: Props) {
  if (!finding) {
    return (
      <aside className="preview empty" aria-label="Finding details">
        <p className="muted">
          Select a finding to see the page screenshot, rule source and history.
        </p>
      </aside>
    );
  }
  return (
    <aside className="preview" aria-label="Finding details">
      <header>
        <div className="preview-badges">
          <SeverityBadge severity={finding.severity} /> <StatusBadge status={finding.status} />
          <SourceTag detectedBy={finding.detectedBy} confidence={finding.confidence} />
          <span className="muted">{CATEGORY_LABEL[finding.rule.category]}</span>
        </div>
        <h2>{finding.rule.title}</h2>
        <p className="muted">
          {pageLabel(finding)}
          {finding.page?.title ? ` · ${finding.page.title}` : ''}
        </p>
      </header>

      {finding.page?.tip && (
        <section className="page-tip" aria-label="Page tip">
          <h3>
            Page tip <span className="tag ai">AI</span>
          </h3>
          <p>{finding.page.tip}</p>
        </section>
      )}

      {finding.page && <Screenshot scanId={scanId} finding={finding} />}

      <dl className="details">
        <dt>Finding</dt>
        <dd>{finding.message}</dd>
        {finding.evidenceText && (
          <>
            <dt>Evidence</dt>
            <dd>
              <q>{finding.evidenceText}</q>
            </dd>
          </>
        )}
        <dt>Suggested fix</dt>
        <dd>{finding.suggestedFix ?? '—'}</dd>
        {finding.editedFix && (
          <>
            <dt>Author's fix</dt>
            <dd>{finding.editedFix}</dd>
          </>
        )}
        {finding.authorComment && (
          <>
            <dt>Comment</dt>
            <dd>{finding.authorComment}</dd>
          </>
        )}
        <dt>Rule</dt>
        <dd>
          {finding.rule.description}
          <br />
          <span className="muted">
            Source:{' '}
            {finding.rule.sourceUrl ? (
              <a href={finding.rule.sourceUrl} target="_blank" rel="noreferrer">
                {finding.rule.sourceCitation}
              </a>
            ) : (
              finding.rule.sourceCitation
            )}{' '}
            ·{' '}
            <Link to={`/rules/${finding.ruleId}?version=${finding.ruleVersion}`}>
              {finding.ruleId} v{finding.ruleVersion}
            </Link>
          </span>
          {finding.rule.sourceNote && (
            <span className="source-note">{finding.rule.sourceNote}</span>
          )}
        </dd>
      </dl>

      <div className="preview-actions">
        {finding.status === 'open' ? (
          <>
            <button
              type="button"
              className="btn accept"
              onClick={() => onAction('accept', finding)}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn reject"
              onClick={() => onAction('reject', finding)}
            >
              Reject
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => onAction('reopen', finding)}>
            Reopen
          </button>
        )}
        <button type="button" className="btn" onClick={() => onAction('edit', finding)}>
          Edit fix
        </button>
        <button type="button" className="btn" onClick={() => onAction('comment', finding)}>
          Comment
        </button>
      </div>

      <SimilarPrecedents key={finding.id} finding={finding} />

      <History findingId={finding.id} />
    </aside>
  );
}

function Screenshot({ scanId, finding }: { scanId: string; finding: FindingView }) {
  const page = finding.page!;
  const loc = finding.evidenceLocation;
  const [view, setView] = useState<'desktop' | 'mobile'>('desktop');
  const src = urls.screenshot(scanId, page.id, view);
  // Natural size of the loaded image, keyed by URL so a stale size is ignored after switching.
  const [loaded, setLoaded] = useState<{ src: string; width: number; height: number } | null>(null);
  const natural = loaded?.src === src ? loaded : null;
  const scroller = useRef<HTMLDivElement>(null);
  const showBox = !!loc && loc.view === view && natural !== null;

  useEffect(() => {
    // Bring the evidence into view once the image size is known.
    if (!showBox || !scroller.current) return;
    const img = scroller.current.querySelector('img');
    const scale = (img?.clientWidth ?? 0) / natural.width;
    scroller.current.scrollTop = Math.max(0, loc.y * scale - 40);
  }, [showBox, loc, natural]);

  return (
    <section className="shot" aria-label="Page screenshot">
      <div role="tablist" aria-label="Screenshot view" className="tabs">
        {(['desktop', 'mobile'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            disabled={!page.screenshots[v]}
            onClick={() => setView(v)}
          >
            {v === 'desktop' ? 'Desktop' : 'Mobile'}
          </button>
        ))}
      </div>
      {page.screenshots[view] ? (
        <div className="shot-scroll" ref={scroller}>
          <div className={`shot-frame ${view}`}>
            <img
              src={src}
              alt={`${view} screenshot of ${page.url}`}
              onLoad={(e) =>
                setLoaded({
                  src,
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
            />
            {showBox && (
              <div
                className="evidence-box"
                data-testid="evidence-box"
                aria-hidden="true"
                style={{
                  left: `${(loc.x / natural.width) * 100}%`,
                  top: `${(loc.y / natural.height) * 100}%`,
                  width: `${(loc.width / natural.width) * 100}%`,
                  height: `${(loc.height / natural.height) * 100}%`,
                }}
              />
            )}
          </div>
        </div>
      ) : (
        <p className="muted">No {view} screenshot for this page.</p>
      )}
      {loc && loc.view !== view && (
        <p className="muted small">The evidence location is marked on the {loc.view} screenshot.</p>
      )}
    </section>
  );
}

function History({ findingId }: { findingId: string }) {
  const { data, isLoading } = useAudit(findingId);
  return (
    <section className="history" aria-label="History">
      <h3>History</h3>
      {isLoading && <p className="muted">Loading…</p>}
      <ol>
        {data?.map((a) => (
          <li key={a.id}>
            <span className="muted">{a.at.slice(0, 16).replace('T', ' ')} UTC</span> ·{' '}
            <strong>{a.actor}</strong> {describe(a.action, a.changes)}
          </li>
        ))}
      </ol>
    </section>
  );
}

function describe(action: string, changes: Record<string, [unknown, unknown]>): string {
  switch (action) {
    case 'created':
      return 'created the finding';
    case 'status_changed': {
      const [from, to] = changes.status ?? [];
      return `changed status ${STATUS_LABEL[from as keyof typeof STATUS_LABEL] ?? from} → ${STATUS_LABEL[to as keyof typeof STATUS_LABEL] ?? to}`;
    }
    case 'fix_edited':
      return `edited the fix to “${String(changes.editedFix?.[1] ?? '')}”`;
    case 'commented':
      return changes.authorComment?.[1]
        ? `commented “${String(changes.authorComment[1])}”`
        : 'cleared the comment';
    default:
      return action;
  }
}
