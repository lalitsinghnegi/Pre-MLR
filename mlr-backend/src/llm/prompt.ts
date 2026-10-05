import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Bump when changing the prompt files; old versions stay on disk so stored analyses stay traceable. */
export const PROMPT_VERSION = 'v1';
const PROMPTS_ROOT = fileURLToPath(new URL('../../prompts/', import.meta.url));

export type PromptFamily = 'page-analysis' | 'precedent-classification';

export interface PromptSet {
  /** e.g. "v1#3fa2c1d0" – the directory version plus a hash of the file contents. */
  version: string;
  system: string;
  userTemplate: string;
}

export async function loadPrompts(
  version = PROMPT_VERSION,
  family: PromptFamily = 'page-analysis',
): Promise<PromptSet> {
  const dir = `${PROMPTS_ROOT}${family}/${version}/`;
  const [system, userTemplate] = await Promise.all([
    readFile(`${dir}system.md`, 'utf8'),
    readFile(`${dir}user.md`, 'utf8'),
  ]);
  const hash = createHash('sha256')
    .update(system)
    .update('\0')
    .update(userTemplate)
    .digest('hex')
    .slice(0, 8);
  return { version: `${version}#${hash}`, system: system.trim(), userTemplate };
}

export interface PromptRule {
  ruleId: string;
  version: number;
  title: string;
  severity: string;
  sourceCitation: string;
  description: string;
  promptTemplate: string | null;
}

/** The rules section; identical for every page of a scan, so it is sent as a cacheable system block. */
export function renderRules(rules: PromptRule[]): string {
  return `Review rules (cite findings by rule id):\n\n${rules
    .map((r) =>
      [
        `<rule id="${r.ruleId}" severity="${r.severity}">`,
        `Title: ${r.title}`,
        `Source: ${r.sourceCitation}`,
        `Description: ${r.description.trim()}`,
        r.promptTemplate ? `What to check: ${r.promptTemplate.trim()}` : null,
        '</rule>',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')}`;
}

export function renderUser(
  template: string,
  page: { url: string; title: string | null; text: string },
  feedback?: string,
): string {
  const values: Record<string, string> = {
    url: page.url,
    title: page.title ?? '(none)',
    text: page.text,
    feedback: feedback
      ? `\nA previous answer was rejected for these reasons; return a corrected answer:\n${feedback}\n`
      : '',
  };
  // Single pass so page text containing "{{...}}" is never re-expanded.
  return template.replace(/\{\{(\w+)\}\}/g, (m, key: string) => values[key] ?? m).trim();
}
