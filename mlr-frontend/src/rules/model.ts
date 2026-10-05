import type { RuleVersion } from '@pre-mlr/shared';

export const CHECK_TYPE_LABEL = { deterministic: 'Rules engine', llm: 'AI (LLM)' } as const;

/** Where a version came from, in words. */
export const originLabel = (v: Pick<RuleVersion, 'origin'>) =>
  v.origin === 'admin' ? 'edited in the app' : v.origin.replace(/^pack:/, 'rule pack ');

export const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  category: 'Category',
  severity: 'Severity',
  checkType: 'Check type',
  enabledByDefault: 'On by default',
  sourceCitation: 'Source citation',
  sourceUrl: 'Source URL',
  sourceNote: 'Source note',
  lastVerified: 'Last verified',
  promptTemplate: 'Prompt template',
  params: 'Settings',
};

/** Per-scan choices: rule id → on/off, for rules where the user changed the default. */
export type RuleChoices = Record<string, boolean>;

/** enable/disable lists for POST /api/scans (only the rules that differ from their default). */
export function overridesOf(
  choices: RuleChoices,
  defaults: Map<string, boolean>,
): { enable: string[]; disable: string[] } {
  const changed = Object.entries(choices).filter(([id, on]) => defaults.get(id) !== on);
  return {
    enable: changed.filter(([, on]) => on).map(([id]) => id),
    disable: changed.filter(([, on]) => !on).map(([id]) => id),
  };
}

export type DiffLine = { kind: 'same' | 'removed' | 'added' | 'gap'; text: string };

/**
 * Line diff (longest common subsequence) showing changed lines with `context` unchanged lines
 * around them; longer unchanged runs collapse to a "gap" marker. Fine for rule settings, which are
 * short.
 */
export function diffLines(before: string, after: string, context = 1): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const all: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      all.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i]![j + 1]! > lcs[i + 1]![j]!)) {
      all.push({ kind: 'added', text: b[j++]! });
    } else {
      all.push({ kind: 'removed', text: a[i++]! });
    }
  }
  const near = (k: number) =>
    all.slice(Math.max(0, k - context), k + context + 1).some((l) => l.kind !== 'same');
  const out: DiffLine[] = [];
  all.forEach((line, k) => {
    if (line.kind !== 'same' || near(k)) out.push(line);
    else if (out.at(-1)?.kind !== 'gap') out.push({ kind: 'gap', text: '…' });
  });
  return out;
}
