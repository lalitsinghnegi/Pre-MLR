import { describe, expect, it } from 'vitest';
import { diffLines, overridesOf } from './model';

describe('diffLines', () => {
  it('shows changed lines with one line of context and collapses the rest', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
    const after = ['a', 'b', 'c', 'D', 'e', 'f', 'g', 'h'].join('\n');
    expect(diffLines(before, after)).toEqual([
      { kind: 'gap', text: '…' },
      { kind: 'same', text: 'c' },
      { kind: 'removed', text: 'd' },
      { kind: 'added', text: 'D' },
      { kind: 'same', text: 'e' },
      { kind: 'gap', text: '…' },
      { kind: 'same', text: 'g' },
      { kind: 'added', text: 'h' },
    ]);
  });

  it('returns only context-free gaps for identical text', () => {
    expect(diffLines('x\ny', 'x\ny')).toEqual([{ kind: 'gap', text: '…' }]);
  });
});

describe('overridesOf', () => {
  it('sends only choices that differ from each rule default', () => {
    const defaults = new Map([
      ['a', true],
      ['b', false],
      ['c', true],
    ]);
    expect(overridesOf({ a: false, b: true, c: true }, defaults)).toEqual({
      enable: ['b'],
      disable: ['a'],
    });
  });
});
