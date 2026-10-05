import { describe, expect, it } from 'vitest';
import { CHECKS, getCheck } from '../src/checks/registry.js';
import type { CheckContext } from '../src/checks/types.js';
import { block, ctx, facts, ISI, page } from './helpers/check-pages.js';

/** Validate params like the engine does, then run. */
function run(name: keyof typeof CHECKS, params: Record<string, unknown>, context: CheckContext) {
  const check = getCheck(name)!;
  return check.run(check.params.parse({ check: name, ...params }), context);
}

const product = { brandNames: ['Examplin'], establishedName: 'examplinumab' };

describe('getCheck', () => {
  it('resolves known checks only', () => {
    expect(getCheck('phrase-list')).toBeDefined();
    expect(getCheck('toString')).toBeUndefined();
    expect(getCheck(undefined)).toBeUndefined();
  });
});

describe('required-heading', () => {
  it('flags in-scope pages without the heading', () => {
    const pages = [
      page('home', { facts: facts([block(ISI, { headingLevel: 2 })]) }),
      page('about', { facts: facts([block('About us')]) }),
      page('privacy', { facts: facts([block('Privacy')]) }),
      page('gone', { httpStatus: 404, error: 'HTTP 404' }),
    ];
    const out = run(
      'required-heading',
      { headings: [ISI], excludePaths: ['/privacy'] },
      ctx(pages),
    );
    expect(out.map((f) => f.pageId)).toEqual(['about']);
    expect(out[0]!.message).toContain(ISI);
  });

  it('falls back to plain text lines for pages without facts', () => {
    const out = run(
      'required-heading',
      { headings: [ISI] },
      ctx([page('home', { text: `Intro\n${ISI}\nRisks` })]),
    );
    expect(out).toEqual([]);
  });
});

describe('section-readability', () => {
  const params = { sectionHeadings: [ISI] };

  it('flags small or low-contrast text in the section, with the first offender as evidence', () => {
    const tiny = block('Serious side effects may occur.', {
      fontSize: 9,
      color: [187, 187, 187, 1],
      background: [244, 244, 244, 1],
    });
    const pages = [
      page('home', {
        facts: facts([
          block('Big benefit!', { fontSize: 9 }),
          block(ISI, { headingLevel: 2 }),
          block('Do not take if allergic.'),
          tiny,
        ]),
      }),
    ];
    const [f, ...rest] = run('section-readability', params, ctx(pages));
    expect(rest).toEqual([]);
    expect(f!.message).toMatch(/1 block\(s\).*9px text, contrast 1\.\d:1/);
    expect(f!.evidenceText).toBe('Serious side effects may occur.');
    expect(f!.evidenceLocation).toEqual({ view: 'desktop', ...tiny.box });
  });

  it('applies the 3:1 large-text threshold to large or bold text', () => {
    const grey = [140, 140, 140, 1] as [number, number, number, number]; // ~3.3:1 on white
    const pages = [
      page('home', {
        facts: facts([
          block(ISI, { headingLevel: 2, fontSize: 24, color: grey }),
          block('Bold risk', { fontSize: 19, fontWeight: 700, color: grey }),
        ]),
      }),
    ];
    expect(run('section-readability', params, ctx(pages))).toEqual([]);
    pages[0]!.facts!.blocks.push(block('Normal risk', { color: grey }));
    expect(run('section-readability', params, ctx(pages))).toHaveLength(1);
  });

  it('skips pages without facts or without the section', () => {
    expect(
      run(
        'section-readability',
        params,
        ctx([page('home', { text: ISI }), page('about', { facts: facts([block('x')]) })]),
      ),
    ).toEqual([]);
  });
});

describe('required-link', () => {
  const pi = {
    name: 'Prescribing Information',
    linkText: ['Prescribing Information'],
    hrefContains: ['prescribing-information'],
  };
  const piLink = { href: 'https://examplin.test/pi.pdf', text: 'Full Prescribing Information' };

  it('present: flags pages without a matching link (by text or URL)', () => {
    const pages = [
      page('home', { links: [piLink] }),
      page('about', {
        links: [{ href: 'https://cdn.test/docs/prescribing-information.pdf', text: 'PI' }],
      }),
      page('faq', { links: [{ href: 'https://examplin.test/', text: 'Home' }] }),
    ];
    expect(
      run('required-link', { ...pi, mode: 'present' }, ctx(pages)).map((f) => f.pageId),
    ).toEqual(['faq']);
  });

  it('resolves: flags matched links that are broken, located on the page', () => {
    const linkBlock = block('Full Prescribing Information');
    const pages = [
      page('home', { links: [piLink, piLink], facts: facts([block('Hi'), linkBlock]) }),
      page('about'),
    ];
    const out = run(
      'required-link',
      { ...pi, mode: 'resolves' },
      ctx(pages, { links: { [piLink.href]: { ok: false, httpStatus: 404, error: 'HTTP 404' } } }),
    );
    expect(out).toEqual([
      expect.objectContaining({
        pageId: 'home',
        message: 'The Prescribing Information link is broken (HTTP 404).',
        evidenceText: `Full Prescribing Information → ${piLink.href}`,
        evidenceLocation: { view: 'desktop', ...linkBlock.box },
      }),
    ]);
  });

  it('present-and-resolves reports both problems; unchecked links are not assumed broken', () => {
    const pages = [page('home', { links: [piLink] }), page('about')];
    expect(
      run('required-link', { ...pi, mode: 'present-and-resolves' }, ctx(pages)).map(
        (f) => f.pageId,
      ),
    ).toEqual(['about']);
  });
});

describe('required-text', () => {
  const ae = {
    missing: 'the AE statement',
    match: 'all',
    patterns: ['fda\\.gov/medwatch', '1\\s*[-–]?\\s*800\\s*[-–]?\\s*FDA\\s*[-–]?\\s*1088'],
    onlyIfHeadings: [ISI],
  };

  it('all: requires every pattern, only on pages with the heading; accepts en dashes', () => {
    const pages = [
      page('ok', { text: `${ISI}\nVisit www.fda.gov/medwatch, or call 1–800-FDA-1088.` }),
      page('half', { text: `${ISI}\nVisit www.fda.gov/medwatch.` }),
      page('no-isi', { text: 'Nothing here' }),
    ];
    expect(run('required-text', ae, ctx(pages)).map((f) => f.pageId)).toEqual(['half']);
  });

  it('any: one pattern is enough', () => {
    const params = {
      missing: 'a date',
      match: 'any',
      patterns: ['©\\s*\\d{4}', 'last\\s+updated'],
    };
    const pages = [
      page('a', { text: '© 2026 Example' }),
      page('b', { text: 'Last updated May' }),
      page('c', { text: 'nothing' }),
    ];
    expect(run('required-text', params, ctx(pages)).map((f) => f.pageId)).toEqual(['c']);
  });

  it('rejects invalid regular expressions', () => {
    expect(() =>
      run('required-text', { missing: 'x', match: 'any', patterns: ['('] }, ctx([])),
    ).toThrow(/valid regular expression/);
  });
});

describe('phrase-list', () => {
  const params = {
    label: 'Superlative',
    phrases: ['best', 'the only', '#1'],
    skipRegions: ['nav'],
  };

  it('reports one finding per sentence listing every matched phrase', () => {
    const b = block(
      'Examplin is the best and the only option. Ask your doctor. Rated #1 by BEST users.',
    );
    const out = run('phrase-list', params, ctx([page('home', { facts: facts([b]) })]));
    expect(out.map((f) => [f.message, f.evidenceText])).toEqual([
      ['Superlative: "best", "the only".', 'Examplin is the best and the only option.'],
      ['Superlative: "#1", "best".', 'Rated #1 by BEST users.'],
    ]);
    expect(out[0]!.evidenceLocation).toEqual({ view: 'desktop', ...b.box });
  });

  it('skips configured regions and sections', () => {
    const pages = [
      page('home', {
        facts: facts([
          block('Best sellers', { region: 'nav' }),
          block(ISI, { headingLevel: 2 }),
          block('The best way to avoid side effects is to talk to your doctor.'),
        ]),
      }),
    ];
    expect(run('phrase-list', { ...params, skipSections: [ISI] }, ctx(pages))).toEqual([]);
  });
});

describe('numeric-claims', () => {
  const params = {
    patterns: ['\\d+(?:\\.\\d+)?\\s?%', '\\b\\d+\\s+(?:out\\s+)?of\\s+\\d+\\b'],
    markerPattern: '[*†‡§]|\\[\\d+\\]',
    skipSections: [ISI],
    skipRegions: ['footer'],
  };

  it('flags numeric claims without a reference marker', () => {
    const pages = [
      page('home', {
        facts: facts([
          block('62% of patients improved. 3 out of 4 felt better.*'),
          block('In a study, 40% responded.', { hasSup: true }),
          block('Results [1]: 55% improved.'),
          block(ISI, { headingLevel: 2 }),
          block('Headache occurred in 5% of patients.'),
          block('© 2026, 100% owned', { region: 'footer' }),
        ]),
      }),
    ];
    expect(run('numeric-claims', params, ctx(pages)).map((f) => f.evidenceText)).toEqual([
      '62% of patients improved.',
    ]);
  });
});

describe('alt-text', () => {
  it('flags meaningful images without alt; skips decorative, hidden and tiny ones', () => {
    const img = (src: string, o = {}) => ({
      src,
      alt: null,
      role: null,
      ariaHidden: false,
      box: { x: 0, y: 0, width: 120, height: 80 },
      ...o,
    });
    const pages = [
      page('home', {
        facts: facts(
          [],
          [
            img('https://examplin.test/img/hero%20image.png'),
            img('https://examplin.test/a.png', { alt: '' }),
            img('https://examplin.test/b.png', { ariaHidden: true }),
            img('https://examplin.test/c.png', { role: 'presentation' }),
            img('https://examplin.test/d.png', { box: { x: 0, y: 0, width: 10, height: 10 } }),
            img('data:image/png;base64,AAAA'),
          ],
        ),
      }),
    ];
    expect(run('alt-text', {}, ctx(pages)).map((f) => f.evidenceText)).toEqual([
      'Image: hero image.png',
      'Image: data:image/png;base64,… (inline)',
    ]);
  });
});

describe('brand-names', () => {
  it('does nothing without a product profile', () => {
    expect(
      run(
        'brand-names',
        { requirement: 'established-name' },
        ctx([page('home', { text: 'Examplin' })]),
      ),
    ).toEqual([]);
  });

  it('established-name: flags pages mentioning the brand without the established name', () => {
    const pages = [
      page('a', { facts: facts([block('Examplin (examplinumab) injection')]) }),
      page('b', { facts: facts([block('Meet Examplin. It helps.')]) }),
      page('c', { facts: facts([block('Examplinx is another brand.')]) }),
    ];
    const out = run('brand-names', { requirement: 'established-name' }, ctx(pages, { product }));
    expect(out.map((f) => [f.pageId, f.evidenceText])).toEqual([['b', 'Meet Examplin.']]);
  });

  it('trademark-symbol: checks only the first mention', () => {
    const pages = [
      page('ok', { facts: facts([block('Examplin® helps. Examplin again.')]) }),
      page('ok2', { facts: facts([block('Examplin (R) helps.')]) }),
      page('bad', { facts: facts([block('Welcome'), block('Examplin helps. Examplin® later.')]) }),
    ];
    const out = run('brand-names', { requirement: 'trademark-symbol' }, ctx(pages, { product }));
    expect(out.map((f) => [f.pageId, f.evidenceText])).toEqual([['bad', 'Examplin helps.']]);
  });
});

describe('link-health', () => {
  it('flags each broken http(s) link once per page', () => {
    const links = [
      { href: 'https://examplin.test/old#x', text: 'Old page' },
      { href: 'https://examplin.test/old', text: 'Old page again' },
      { href: 'https://ok.test/', text: 'Fine' },
      { href: 'https://unchecked.test/', text: 'Unchecked' },
      { href: 'https://ads.test/pixel', text: 'Ad' },
      { href: 'mailto:a@b.test', text: 'Mail' },
    ];
    const out = run(
      'link-health',
      { ignoreUrlsContaining: ['ads.test'] },
      ctx([page('home', { links })], {
        links: {
          'https://examplin.test/old': { ok: false, httpStatus: 404, error: 'HTTP 404' },
          'https://ok.test/': { ok: true, httpStatus: 200, error: null },
          'https://ads.test/pixel': { ok: false, httpStatus: 500, error: 'HTTP 500' },
        },
      }),
    );
    expect(out.map((f) => [f.message, f.evidenceText])).toEqual([
      ['Broken link (HTTP 404).', 'Old page → https://examplin.test/old'],
    ]);
  });
});
