import { describe, expect, it } from 'vitest';
import {
  compareFindings,
  formatComparison,
  pagePath,
  type ActualFinding,
} from '../src/eval/compare.js';

const a = (page: string, rule: string, evidence: string | null = null): ActualFinding => ({
  page,
  rule,
  evidence,
  detectedBy: 'rules_engine',
});
const e = (page: string, rule: string, evidence?: string) => ({
  page,
  rule,
  evidence,
  detectedBy: 'rules_engine' as const,
});

describe('compareFindings', () => {
  it('matches by page and rule, and by evidence substring when given', () => {
    const c = compareFindings(
      [
        e('/', 'superlatives', 'THE BEST'),
        e('/dosing', 'broken-links', '2019'),
        e('/dosing', 'broken-links', 'support'),
        e('/faq', 'privacy-link'),
      ],
      [
        a('/dosing', 'broken-links', 'Support site → https://support.invalid/'),
        a('/', 'superlatives', 'It is the best.'),
        a('/dosing', 'broken-links', 'PI → /pi-2019.pdf'),
        a('/faq', 'privacy-link'),
      ],
    );
    expect(c.missing).toEqual([]);
    expect(c.unexpected).toEqual([]);
    expect(c.matched).toHaveLength(4);
  });

  it('reports missing and unexpected findings; each actual matches once', () => {
    const c = compareFindings(
      [e('/', 'alt-text'), e('/', 'alt-text'), e('/x', 'isi-present', 'nope')],
      [a('/', 'alt-text'), a('/', 'superlatives')],
    );
    expect(c.missing.map((m) => m.rule)).toEqual(['isi-present', 'alt-text']);
    expect(c.unexpected.map((u) => u.rule)).toEqual(['superlatives']);
    expect(formatComparison(c)).toMatch(
      /matched 1, missing 2, unexpected 1[\s\S]*MISSING[\s\S]*UNEXPECTED[\s\S]*superlatives/,
    );
  });

  it('gives evidence-specific entries priority over vague ones', () => {
    const c = compareFindings(
      [e('/', 'broken-links'), e('/', 'broken-links', 'old.pdf')],
      [a('/', 'broken-links', 'old.pdf'), a('/', 'broken-links', 'other')],
    );
    expect(c.missing).toEqual([]);
  });
});

describe('pagePath', () => {
  it.each([
    ['https://x.test/', '/'],
    ['https://x.test', '/'],
    ['https://x.test/faq.html', '/faq'],
    ['https://x.test/products/', '/products'],
  ])('%s → %s', (url, path) => expect(pagePath(url)).toBe(path));
});
