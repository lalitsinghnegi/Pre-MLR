import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  findSection,
  isExcluded,
  pagesInScope,
  phraseRegex,
  sentences,
} from '../src/checks/text.js';
import { block, page, ISI } from './helpers/check-pages.js';

describe('contrastRatio', () => {
  it('matches WCAG reference values', () => {
    expect(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 1);
    expect(contrastRatio([255, 255, 255, 1], [255, 255, 255, 1])).toBeCloseTo(1, 5);
    expect(contrastRatio([118, 118, 118, 1], [255, 255, 255, 1])).toBeCloseTo(4.54, 1); // #767676
    expect(contrastRatio([187, 187, 187, 1], [244, 244, 244, 1])).toBeLessThan(2);
  });

  it('blends translucent text over the background', () => {
    expect(contrastRatio([0, 0, 0, 0.5], [255, 255, 255, 1])).toBeLessThan(
      contrastRatio([0, 0, 0, 1], [255, 255, 255, 1]),
    );
  });
});

describe('isExcluded', () => {
  it.each([
    ['https://x.test/privacy', ['/privacy'], true],
    ['https://x.test/privacy.html', ['/privacy'], true],
    ['https://x.test/Privacy/', ['/privacy'], true],
    ['https://x.test/privacy/cookies', ['/privacy'], true],
    ['https://x.test/privacy-center', ['/privacy'], false],
    ['https://x.test/legal-notice', ['/legal*'], true],
    ['https://x.test/', ['/privacy'], false],
  ])('%s with %j → %s', (url, patterns, expected) => {
    expect(isExcluded(url, patterns)).toBe(expected);
  });
});

describe('pagesInScope', () => {
  it('drops failed pages and excluded paths', () => {
    const pages = [
      page('home'),
      page('privacy'),
      page('gone', { httpStatus: 404, error: 'HTTP 404' }),
    ];
    expect(pagesInScope(pages, ['/privacy']).map((p) => p.id)).toEqual(['home']);
  });
});

describe('findSection', () => {
  it('runs from the heading to the next heading of the same or higher level', () => {
    const blocks = [
      block('Intro'),
      block(ISI, { headingLevel: 2 }),
      block('Risk one'),
      block('Indications', { headingLevel: 3 }),
      block('Risk two'),
      block('Next section', { headingLevel: 2 }),
    ];
    expect(findSection(blocks, [ISI])!.map((b) => b.text)).toEqual([
      ISI,
      'Risk one',
      'Indications',
      'Risk two',
    ]);
  });

  it('stops where the landmark region changes and runs to the end without heading levels', () => {
    const blocks = [block(ISI), block('Risk'), block('© 2026 Example', { region: 'footer' })];
    expect(findSection(blocks, [ISI])!.map((b) => b.text)).toEqual([ISI, 'Risk']);
  });

  it('matches headings case-insensitively within short blocks only', () => {
    expect(findSection([block('INDICATION AND IMPORTANT SAFETY INFORMATION')], [ISI])).toHaveLength(
      1,
    );
    expect(
      findSection(
        [block(`Read the ${ISI} below before you start taking this medicine every day.`.repeat(2))],
        [ISI],
      ),
    ).toBeNull();
  });
});

describe('phraseRegex', () => {
  it('matches whole words/phrases only, case-insensitively, across whitespace', () => {
    expect('The BEST choice').toMatch(phraseRegex('best'));
    expect('bestseller').not.toMatch(phraseRegex('best'));
    expect('the  only\noption').toMatch(phraseRegex('the only'));
    expect('Rated #1 by users').toMatch(phraseRegex('#1'));
    expect('Rated #10 by users').not.toMatch(phraseRegex('#1'));
    expect('100% natural').toMatch(phraseRegex('100%'));
    expect('A vs. B').toMatch(phraseRegex('vs.'));
  });
});

describe('sentences', () => {
  it('splits on sentence punctuation followed by a capital or digit', () => {
    expect(sentences('One thing. Two things! 3 more? e.g. not split')).toEqual([
      'One thing.',
      'Two things!',
      '3 more? e.g. not split',
    ]);
  });
});
