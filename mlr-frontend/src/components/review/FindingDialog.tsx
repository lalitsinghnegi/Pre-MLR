import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { FindingStatus, FindingView } from '@pre-mlr/shared';
import { STATUS_LABEL, pageLabel } from '../../review/model';

export type DialogState =
  | { kind: 'edit'; finding: FindingView }
  | { kind: 'comment'; finding: FindingView }
  | { kind: 'bulk'; status: Exclude<FindingStatus, 'edited'>; count: number };

export interface DialogResult {
  editedFix?: string;
  comment?: string | null;
}

interface Props {
  state: DialogState | null;
  busy: boolean;
  onSubmit: (result: DialogResult) => void;
  onClose: () => void;
}

/** Native <dialog>: focus is trapped and Esc closes it. */
export function FindingDialog({ state, busy, onSubmit, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (state && !dialog.open) dialog.showModal();
    if (!state && dialog.open) dialog.close();
  }, [state]);

  // Keyed so the form's fields start from the finding being edited each time.
  const key = state
    ? state.kind === 'bulk'
      ? `bulk:${state.status}`
      : `${state.kind}:${state.finding.id}`
    : 'none';
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dialog-title" onClose={onClose}>
      {state && (
        <DialogForm key={key} state={state} busy={busy} onSubmit={onSubmit} onCancel={onClose} />
      )}
    </dialog>
  );
}

function DialogForm({
  state,
  busy,
  onSubmit,
  onCancel,
}: {
  state: DialogState;
  busy: boolean;
  onSubmit: (r: DialogResult) => void;
  onCancel: () => void;
}) {
  const finding = state.kind === 'bulk' ? null : state.finding;
  const [fix, setFix] = useState(finding?.editedFix ?? finding?.suggestedFix ?? '');
  const [comment, setComment] = useState(finding?.authorComment ?? '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (state.kind === 'edit') onSubmit({ editedFix: fix.trim(), comment: comment.trim() || null });
    else if (state.kind === 'comment') onSubmit({ comment: comment.trim() || null });
    else onSubmit({ comment: comment.trim() || undefined });
  };

  const title =
    state.kind === 'edit'
      ? 'Edit suggested fix'
      : state.kind === 'comment'
        ? 'Comment'
        : `${STATUS_LABEL[state.status]} ${state.count} finding${state.count === 1 ? '' : 's'}`;

  return (
    <form onSubmit={submit}>
      <h2 id="dialog-title">{title}</h2>
      {finding && (
        <p className="muted">
          {finding.rule.title} · {pageLabel(finding)}
        </p>
      )}
      {state.kind === 'edit' && (
        <>
          <p className="label">Original suggestion</p>
          <p className="original">{state.finding.suggestedFix ?? '— (none)'}</p>
          <label className="field">
            <span>Your fix</span>
            <textarea required rows={4} value={fix} onChange={(e) => setFix(e.target.value)} />
          </label>
        </>
      )}
      <label className="field">
        <span>{state.kind === 'comment' ? 'Comment' : 'Comment (optional)'}</span>
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn primary"
          disabled={busy || (state.kind === 'edit' && !fix.trim())}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
