import { z } from 'zod';
import {
  blocksOf,
  blocksOutside,
  contrastRatio,
  findBlockContaining,
  findSection,
  httpLinks,
  isHeadingMatch,
  locationOf,
  pagesInScope,
  phraseRegex,
  sentences,
  truncate,
  type CheckBlock,
} from './text.js';
import type { CheckDefinition, CheckFinding, LinkStatus } from './types.js';

const Base = z.object({
  check: z.string(),
  /** URL paths the rule skips; see isExcluded. Filled from pack defaults when omitted. */
  excludePaths: z.array(z.string()).default([]),
  /** Overrides the check's default suggested fix. */
  suggestedFix: z.string().optional(),
});

const nonEmpty = z.array(z.string().trim().min(1)).min(1);

/** Validates that each regex compiles (case-insensitive, unicode). */
const regexList = nonEmpty.refine(
  (list) =>
    list.every((p) => {
      try {
        new RegExp(p, 'iu');
        return true;
      } catch {
        return false;
      }
    }),
  'every pattern must be a valid regular expression',
);

const define = <P>(d: CheckDefinition<P>) => d;

// ---------------------------------------------------------------------------------------------

const requiredHeading = define({
  params: Base.extend({ headings: nonEmpty }),
  run(p, ctx) {
    return pagesInScope(ctx.pages, p.excludePaths)
      .filter((page) => !blocksOf(page).some((b) => isHeadingMatch(b, p.headings)))
      .map((page) => ({
        pageId: page.id,
        message: `No "${p.headings[0]}" section found on this page.`,
        suggestedFix: p.suggestedFix ?? `Add the "${p.headings[0]}" section to this page.`,
      }));
  },
});

const sectionReadability = define({
  params: Base.extend({
    sectionHeadings: nonEmpty,
    minFontPx: z.number().positive().default(12),
    minContrast: z.number().positive().default(4.5),
    /** WCAG large text: >= 24px, or >= 18.66px bold. */
    minContrastLarge: z.number().positive().default(3),
    largeFontPx: z.number().positive().default(24),
    largeBoldFontPx: z.number().positive().default(18.66),
  }),
  run(p, ctx) {
    const out: CheckFinding[] = [];
    for (const page of pagesInScope(ctx.pages, p.excludePaths)) {
      if (!page.facts) continue; // needs styles
      const section = findSection(page.facts.blocks, p.sectionHeadings);
      if (!section) continue; // a missing section is the required-heading check's job
      const problems = section
        .map((b) => ({ block: b, issue: readabilityIssue(b, p) }))
        .filter((x): x is { block: CheckBlock; issue: string } => x.issue !== null);
      if (!problems.length) continue;
      const first = problems[0]!;
      out.push({
        pageId: page.id,
        message:
          `${problems.length} block(s) of "${p.sectionHeadings[0]}" text fall below the readability minimum ` +
          `(${p.minFontPx}px, contrast ${p.minContrast}:1). First: ${first.issue}.`,
        evidenceText: truncate(first.block.text),
        evidenceLocation: locationOf(first.block),
        suggestedFix:
          p.suggestedFix ??
          `Present this text at ${p.minFontPx}px or larger with contrast of at least ${p.minContrast}:1, comparable to the benefit text.`,
      });
    }
    return out;
  },
});

function readabilityIssue(
  b: CheckBlock,
  p: {
    minFontPx: number;
    minContrast: number;
    minContrastLarge: number;
    largeFontPx: number;
    largeBoldFontPx: number;
  },
): string | null {
  if (b.fontSize === undefined || !b.color || !b.background) return null;
  const issues: string[] = [];
  if (b.fontSize < p.minFontPx) issues.push(`${b.fontSize}px text`);
  const large =
    b.fontSize >= p.largeFontPx ||
    (b.fontSize >= p.largeBoldFontPx && (b.fontWeight ?? 400) >= 700);
  const ratio = contrastRatio(b.color, b.background);
  if (ratio < (large ? p.minContrastLarge : p.minContrast))
    issues.push(`contrast ${ratio.toFixed(1)}:1`);
  return issues.length ? issues.join(', ') : null;
}

const requiredLink = define({
  params: Base.extend({
    /** Case-insensitive substrings of the link text. */
    linkText: nonEmpty,
    /** Case-insensitive substrings of the URL that also identify the link (e.g. "prescribing-information"). */
    hrefContains: z.array(z.string().trim().min(1)).default([]),
    /** present: the link must exist; resolves: matched links must work; both: both. */
    mode: z.enum(['present', 'resolves', 'present-and-resolves']),
    /** Human name for messages, e.g. "Prescribing Information". */
    name: z.string().min(1),
  }),
  run(p, ctx) {
    const out: CheckFinding[] = [];
    for (const page of pagesInScope(ctx.pages, p.excludePaths)) {
      const matches = uniqueLinks(page).filter(
        (l) =>
          p.linkText.some((t) => l.text.toLowerCase().includes(t.toLowerCase())) ||
          p.hrefContains.some((h) => l.href.toLowerCase().includes(h.toLowerCase())),
      );
      if (p.mode !== 'resolves' && matches.length === 0) {
        out.push({
          pageId: page.id,
          message: `No link to the ${p.name} on this page.`,
          suggestedFix: p.suggestedFix ?? `Add a clearly labelled link to the ${p.name}.`,
        });
      }
      if (p.mode === 'present') continue;
      const blocks = blocksOf(page);
      for (const l of matches) {
        const status = ctx.link(l.href);
        if (!status || status.ok) continue;
        if (status.unverified) {
          out.push(unverifiedFinding(page.id, l.text, l.href, blocks, status, `${p.name} link`));
          continue;
        }
        out.push({
          pageId: page.id,
          message: `The ${p.name} link is broken (${status.error ?? `HTTP ${status.httpStatus}`}).`,
          evidenceText: `${l.text || '(no link text)'} → ${l.href}`,
          evidenceLocation: locationOf(findBlockContaining(blocks, l.text)),
          suggestedFix: p.suggestedFix ?? `Point this link at the current ${p.name} document.`,
        });
      }
    }
    return out;
  },
});

/**
 * An info note, not a broken-link finding: the site refused automated checks (bot protection),
 * even from a browser, so a person should open the link to confirm it works.
 */
function unverifiedFinding(
  pageId: string,
  text: string,
  href: string,
  blocks: CheckBlock[],
  status: LinkStatus,
  what: string,
): CheckFinding {
  const host = (() => {
    try {
      return new URL(href).host;
    } catch {
      return 'The site';
    }
  })();
  return {
    pageId,
    severity: 'info',
    message: `Couldn't confirm this ${what} automatically: ${host} refused automated checks${status.httpStatus ? ` (HTTP ${status.httpStatus})` : ''}. It is not known to be broken.`,
    evidenceText: `${text || '(no link text)'} → ${href}`,
    evidenceLocation: locationOf(findBlockContaining(blocks, text)),
    suggestedFix: 'Open the link in a browser to confirm it works.',
  };
}

/** All links with their raw href (incl. non-http), de-duplicated by href. */
function uniqueLinks(page: { links: { href: string; text: string }[] }) {
  const seen = new Set<string>();
  return page.links.filter((l) => !seen.has(l.href) && seen.add(l.href));
}

const requiredText = define({
  params: Base.extend({
    /** Regular expressions (case-insensitive) searched in the page's visible text. */
    patterns: regexList,
    match: z.enum(['all', 'any']),
    /** Only check pages that have one of these headings (e.g. the ISI). */
    onlyIfHeadings: z.array(z.string().trim().min(1)).default([]),
    /** What is missing, for the message, e.g. "the FDA adverse-event reporting statement". */
    missing: z.string().min(1),
  }),
  run(p, ctx) {
    const regexes = p.patterns.map((r) => new RegExp(r, 'iu'));
    return pagesInScope(ctx.pages, p.excludePaths)
      .filter(
        (page) =>
          !p.onlyIfHeadings.length ||
          blocksOf(page).some((b) => isHeadingMatch(b, p.onlyIfHeadings)),
      )
      .filter((page) => {
        const text = page.text ?? '';
        const hits = regexes.map((r) => r.test(text));
        return p.match === 'all' ? !hits.every(Boolean) : !hits.some(Boolean);
      })
      .map((page) => ({
        pageId: page.id,
        message: `This page is missing ${p.missing}.`,
        suggestedFix: p.suggestedFix ?? `Add ${p.missing}.`,
      }));
  },
});

const phraseList = define({
  params: Base.extend({
    phrases: nonEmpty,
    /** Label for the message, e.g. "Absolute or superlative language". */
    label: z.string().min(1),
    /** Sections (by heading) to skip, e.g. the ISI. */
    skipSections: z.array(z.string()).default([]),
    /** Landmark regions to skip. */
    skipRegions: z.array(z.enum(['header', 'nav', 'footer'])).default([]),
  }),
  run(p, ctx) {
    const regexes = p.phrases.map((phrase) => ({ phrase, re: phraseRegex(phrase) }));
    const out: CheckFinding[] = [];
    for (const page of pagesInScope(ctx.pages, p.excludePaths)) {
      for (const block of blocksOutside(blocksOf(page), p.skipSections, p.skipRegions)) {
        for (const sentence of sentences(block.text)) {
          // Matched phrases in the order they appear in the sentence.
          const found = [
            ...new Set(
              regexes
                .flatMap(({ re }) => [...sentence.matchAll(re)])
                .sort((a, b) => a.index - b.index)
                .map((m) => m[0].toLowerCase()),
            ),
          ];
          if (!found.length) continue;
          out.push({
            pageId: page.id,
            message: `${p.label}: ${found.map((f) => `"${f}"`).join(', ')}.`,
            evidenceText: truncate(sentence),
            evidenceLocation: locationOf(block),
            suggestedFix:
              p.suggestedFix ??
              'Rephrase without this language, or support it with substantial evidence and a reference.',
          });
        }
      }
    }
    return out;
  },
});

const numericClaims = define({
  params: Base.extend({
    patterns: regexList,
    /** A reference marker in the sentence (besides a <sup> in the block). */
    markerPattern: z.string().min(1),
    skipSections: z.array(z.string()).default([]),
    skipRegions: z.array(z.enum(['header', 'nav', 'footer'])).default([]),
  }),
  run(p, ctx) {
    const claims = p.patterns.map((r) => new RegExp(r, 'iu'));
    const marker = new RegExp(p.markerPattern, 'u');
    const out: CheckFinding[] = [];
    for (const page of pagesInScope(ctx.pages, p.excludePaths)) {
      for (const block of blocksOutside(blocksOf(page), p.skipSections, p.skipRegions)) {
        if (block.hasSup) continue;
        for (const sentence of sentences(block.text)) {
          if (!claims.some((r) => r.test(sentence)) || marker.test(sentence)) continue;
          out.push({
            pageId: page.id,
            message: 'Numeric or quantitative claim without a reference marker.',
            evidenceText: truncate(sentence),
            evidenceLocation: locationOf(block),
            suggestedFix:
              p.suggestedFix ??
              'Add a reference (e.g. a superscript citation) to the supporting study, or remove the claim.',
          });
        }
      }
    }
    return out;
  },
});

const altText = define({
  params: Base.extend({
    /** Ignore images smaller than this in both dimensions (spacers, icons inside labelled links). */
    minSizePx: z.number().min(0).default(16),
  }),
  run(p, ctx) {
    const out: CheckFinding[] = [];
    for (const page of pagesInScope(ctx.pages, p.excludePaths)) {
      for (const img of page.facts?.images ?? []) {
        if (img.alt !== null || img.ariaHidden) continue;
        if (img.role === 'presentation' || img.role === 'none') continue;
        if (Math.max(img.box.width, img.box.height) < p.minSizePx) continue;
        out.push({
          pageId: page.id,
          message: 'Image has no alt attribute.',
          evidenceText: `Image: ${shortSrc(img.src)}`,
          evidenceLocation: { view: 'desktop', ...img.box },
          suggestedFix:
            p.suggestedFix ??
            'Add alt text describing the image, or alt="" if it is purely decorative.',
        });
      }
    }
    return out;
  },
});

function shortSrc(src: string): string {
  if (src.startsWith('data:')) return `${src.slice(0, src.indexOf(',') + 1 || 30)}… (inline)`;
  try {
    return decodeURIComponent(new URL(src).pathname.split('/').filter(Boolean).pop() ?? src);
  } catch {
    return truncate(src, 100);
  }
}

const brandNames = define({
  params: Base.extend({
    requirement: z.enum(['established-name', 'trademark-symbol']),
    symbols: z.array(z.string().min(1)).default(['®', '™']),
  }),
  run(p, ctx) {
    const product = ctx.product;
    if (!product) return []; // needs the scan's product profile
    const brandRes = product.brandNames.map(
      (b) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(b)}(?![\\p{L}\\p{N}])`, 'u'),
    );
    const out: CheckFinding[] = [];
    for (const page of pagesInScope(ctx.pages, p.excludePaths)) {
      const blocks = blocksOf(page);
      let first: { block: CheckBlock; index: number; length: number } | undefined;
      for (const block of blocks) {
        const m = brandRes.map((re) => re.exec(block.text)).find(Boolean);
        if (m) {
          first = { block, index: m.index, length: m[0].length };
          break;
        }
      }
      if (!first) continue;
      const sentence =
        sentences(first.block.text).find((s) => brandRes.some((re) => re.test(s))) ??
        first.block.text;

      if (p.requirement === 'established-name') {
        if ((page.text ?? '').toLowerCase().includes(product.establishedName.toLowerCase()))
          continue;
        out.push({
          pageId: page.id,
          message: `Brand name appears without the established name "${product.establishedName}".`,
          evidenceText: truncate(sentence),
          evidenceLocation: locationOf(first.block),
          suggestedFix:
            p.suggestedFix ??
            `Show the established name with the brand name, e.g. "${product.brandNames[0]} (${product.establishedName})".`,
        });
      } else {
        const after = first.block.text.slice(first.index + first.length).trimStart();
        if (p.symbols.some((s) => after.startsWith(s)) || /^\((R|TM)\)/i.test(after)) continue;
        out.push({
          pageId: page.id,
          message: 'First brand-name mention on the page has no trademark symbol.',
          evidenceText: truncate(sentence),
          evidenceLocation: locationOf(first.block),
          suggestedFix:
            p.suggestedFix ??
            `Add ${p.symbols.join(' or ')} to the first prominent brand-name mention.`,
        });
      }
    }
    return out;
  },
});

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const linkHealth = define({
  params: Base.extend({
    /** Skip links whose URL contains any of these (case-insensitive). */
    ignoreUrlsContaining: z.array(z.string().min(1)).default([]),
  }),
  run(p, ctx) {
    const out: CheckFinding[] = [];
    const inScope = pagesInScope(ctx.pages, p.excludePaths);
    // A link that couldn't be confirmed is noted once (on the first page that has it), not on
    // every page: shared header and footer links would otherwise repeat on each page.
    const unverifiedOn = new Map<string, number>();
    for (const page of inScope)
      for (const { url } of httpLinks(page))
        if (ctx.link(url)?.unverified) unverifiedOn.set(url, (unverifiedOn.get(url) ?? 0) + 1);
    const noted = new Set<string>();
    for (const page of inScope) {
      const blocks = blocksOf(page);
      for (const { url, text } of httpLinks(page)) {
        if (p.ignoreUrlsContaining.some((s) => url.toLowerCase().includes(s.toLowerCase())))
          continue;
        const status = ctx.link(url);
        if (!status || status.ok) continue;
        if (status.unverified) {
          if (noted.has(url)) continue;
          noted.add(url);
          const f = unverifiedFinding(page.id, text, url, blocks, status, 'link');
          const pages = unverifiedOn.get(url) ?? 1;
          out.push(pages > 1 ? { ...f, message: `${f.message} Linked from ${pages} pages.` } : f);
          continue;
        }
        out.push({
          pageId: page.id,
          message: `Broken link (${status.error ?? `HTTP ${status.httpStatus}`}).`,
          evidenceText: `${text || '(no link text)'} → ${url}`,
          evidenceLocation: locationOf(findBlockContaining(blocks, text)),
          suggestedFix: p.suggestedFix ?? 'Fix or remove the link.',
        });
      }
    }
    return out;
  },
});

// ---------------------------------------------------------------------------------------------

export const CHECKS = {
  'required-heading': requiredHeading,
  'section-readability': sectionReadability,
  'required-link': requiredLink,
  'required-text': requiredText,
  'phrase-list': phraseList,
  'numeric-claims': numericClaims,
  'alt-text': altText,
  'brand-names': brandNames,
  'link-health': linkHealth,
} as const;

export type CheckName = keyof typeof CHECKS;

export function getCheck(name: unknown): CheckDefinition | undefined {
  return typeof name === 'string' && Object.hasOwn(CHECKS, name)
    ? (CHECKS[name as CheckName] as unknown as CheckDefinition)
    : undefined;
}
