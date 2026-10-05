import { useId, useState } from 'react';
import { ApiError } from '../../api/client';
import { useCreateRuleCandidate, useIsRuleAdmin } from '../../api/queries';

interface Props {
  precedentIds: string[];
  /** Prefilled working title for the proposed rule. */
  suggestedTitle: string;
  findingId?: string;
}

/**
 * "Promote to rule candidate", shown only to rule admins. Opens a small form for a working title
 * and a note; the proposal is recorded (and audited) for the rule owners, not turned into a rule.
 */
export function PromoteButton({ precedentIds, suggestedTitle, findingId }: Props) {
  const isAdmin = useIsRuleAdmin();
  const create = useCreateRuleCandidate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const id = useId();
  if (!isAdmin) return null;

  if (create.isSuccess) return <p className="small promoted">Proposed as a rule candidate.</p>;
  if (!open) {
    return (
      <button
        type="button"
        className="btn small"
        onClick={() => {
          setTitle(suggestedTitle.slice(0, 200));
          setOpen(true);
        }}
      >
        Promote to rule candidate
      </button>
    );
  }
  const already = create.error instanceof ApiError && create.error.status === 409;
  return (
    <form
      className="promote-form"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({
          title: title.trim(),
          precedentIds,
          findingId,
          note: note.trim() || undefined,
        });
      }}
    >
      <label htmlFor={`${id}-title`}>Working title for the proposed rule</label>
      <input
        id={`${id}-title`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        minLength={3}
        maxLength={200}
        required
      />
      <label htmlFor={`${id}-note`}>Note for the rule owners (optional)</label>
      <textarea
        id={`${id}-note`}
        rows={2}
        maxLength={2000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {create.isError && (
        <p className="error small" role="alert">
          {already
            ? 'These comments have already been proposed as a rule candidate.'
            : create.error.message}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="btn small primary" disabled={create.isPending}>
          Propose
        </button>
        <button type="button" className="btn small" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
