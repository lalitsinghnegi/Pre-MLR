// Generates the synthetic precedent dataset (fictional brands and people only):
//   npm run precedent:generate -w mlr-backend
// Writes test-sites/precedent/synthetic-mlr-comments.{xlsx,csv} plus an answer key of the intended
// category per comment (not part of the export; used to test classification in Prompt 13).
// Deterministic: a fixed seed means the same files every run.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import ExcelJS from 'exceljs';

const { values: args } = parseArgs({ options: { out: { type: 'string' } } });
const OUT = args.out ? resolve(args.out) : join(import.meta.dirname, '../../test-sites/precedent');
const SEED = 20261003;
const COUNT = 150;

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
function weighted<T>(entries: readonly [T, number][]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of entries) if ((r -= w) < 0) return v;
  return entries.at(-1)![0];
}

const BRANDS = ['Examplin', 'Fictorex', 'Placebrin', 'Demovia'] as const;
const PAGES = ['Home', 'Efficacy', 'Safety', 'Dosing', 'Savings', 'FAQ'] as const;
const REVIEWERS = [
  ['Dana Whitfield', 'Medical'],
  ['Priya Ramaswamy', 'Medical'],
  ['Tomas Lindqvist', 'Medical'],
  ['Jordan Reyes', 'Legal'],
  ['Hannah Okafor', 'Legal'],
  ['Marcus Bellamy', 'Legal'],
  ['Elena Petrova', 'Regulatory'],
  ['Samuel Achterberg', 'Regulatory'],
  ['Mei-Lin Zhou', 'Regulatory'],
  ['Chris Donnelly', 'Brand/Marketing'],
  ['Aisha Karim', 'Brand/Marketing'],
  ['Olivia Brandt', 'Brand/Marketing'],
] as const;

type Category =
  | 'safety_information'
  | 'fair_balance'
  | 'claims'
  | 'references'
  | 'branding'
  | 'links'
  | 'legal_privacy'
  | 'accessibility'
  | 'off_rule:tone'
  | 'off_rule:image_rights'
  | 'off_rule:translation'
  | 'off_rule:formatting';

const TEMPLATES: Record<Category, string[]> = {
  safety_information: [
    'The {page} page has no Important Safety Information. Please add the full ISI or a persistent ISI tray.',
    'ISI is only linked from the footer on the {page} page; it needs to appear on the page itself.',
    'Add the adverse event reporting statement (MedWatch and 1-800 number) to the ISI.',
    'Boxed warning language is missing from the ISI on the {page} page.',
    'Medication Guide link is missing from the ISI section.',
  ],
  fair_balance: [
    'Risk information is in a much smaller font than the efficacy headline. Please rebalance.',
    'The hero banner presents benefits only; risks need comparable prominence on the {page} page.',
    'ISI tray is collapsed by default on mobile and hides the risks. Keep it expanded.',
    'Efficacy bullets are bold and large while side effects are grey body text. Not fair balance.',
  ],
  claims: [
    '"Best-in-class" is a superlative we cannot support. Remove.',
    '"Guaranteed relief" overstates efficacy. Please soften.',
    'Comparative claim against a competitor requires head-to-head data. Remove or substantiate.',
    'This copy implies use in children, which is outside the indication.',
    '"Works in days" is not supported by the onset data in the PI.',
    '"The only treatment that..." is an absolute claim. Please revise.',
  ],
  references: [
    'The {n}% response claim needs a reference to the pivotal study.',
    'Reference 3 does not support the statement as written.',
    'Footnote numbering is out of order; align it with the reference list.',
    'Please cite the PI section for the dosing statement on the {page} page.',
  ],
  branding: [
    'Established name must accompany {brand} at first mention.',
    'Use the registered trademark symbol on the first prominent use of {brand}.',
    'Established name font size is less than half the size of the brand name.',
  ],
  links: [
    'Prescribing Information link points to an outdated version of the PI.',
    'External link to the patient support site is broken.',
    'Savings card link returns an error page.',
  ],
  legal_privacy: [
    'Privacy policy link is missing from the footer of the {page} page.',
    'Job code is missing on this page.',
    'Copyright year in the footer should be updated.',
  ],
  accessibility: [
    'Hero image on the {page} page needs alt text.',
    'Contrast of the disclaimer text is too low to read.',
    'The mechanism-of-action video needs captions.',
  ],
  'off_rule:tone': [
    'Tone is too casual for an HCP audience. Please revise.',
    'Avoid exclamation marks in patient-facing copy.',
    'Headline reads like an advertisement for a consumer product; make it more measured.',
  ],
  'off_rule:image_rights': [
    'Confirm we have licensing rights for this stock photo.',
    'A model release is required for the patient testimonial image.',
    'Image appears to be from a previous campaign; check usage rights have not expired.',
  ],
  'off_rule:translation': [
    'The German translation of the ISI needs local regulatory sign-off.',
    'French Canadian version uses European French terms; please localize.',
    'Translated headline is longer than the layout allows and gets cut off.',
  ],
  'off_rule:formatting': [
    "Typo: 'asthama' should be 'asthma'.",
    'Bullet alignment is inconsistent in the efficacy section.',
    'Please use sentence case for headings, per the style guide.',
  ],
};

// About 80% map to a rule category, about 20% to topics no rule covers.
const CATEGORY_WEIGHTS: [Category, number][] = [
  ['safety_information', 16],
  ['fair_balance', 10],
  ['claims', 18],
  ['references', 12],
  ['branding', 8],
  ['links', 6],
  ['legal_privacy', 5],
  ['accessibility', 5],
  ['off_rule:tone', 5],
  ['off_rule:image_rights', 5],
  ['off_rule:translation', 5],
  ['off_rule:formatting', 5],
];
const FUNCTION_FOR: Partial<Record<Category, string[]>> = {
  claims: ['Medical', 'Regulatory', 'Legal'],
  references: ['Medical'],
  fair_balance: ['Regulatory', 'Medical'],
  safety_information: ['Regulatory', 'Medical'],
  branding: ['Legal', 'Brand/Marketing'],
  legal_privacy: ['Legal'],
  'off_rule:tone': ['Brand/Marketing', 'Medical'],
  'off_rule:image_rights': ['Legal'],
  'off_rule:translation': ['Regulatory'],
  'off_rule:formatting': ['Brand/Marketing'],
};

const HEADERS = [
  'Proof Name',
  'Version',
  'Page',
  'Comment ID',
  'Comment',
  'Reviewer',
  'Reviewer Function',
  'Status',
  'Date',
  'Brand',
  'Country',
] as const;
type Row = Record<(typeof HEADERS)[number], string | Date>;

const start = Date.UTC(2024, 0, 1);
const end = Date.UTC(2026, 8, 30);
const rows: Row[] = [];
const labels: Record<string, Category | 'invalid' | 'duplicate'> = {};

for (let i = 1; i <= COUNT; i++) {
  const category = weighted(CATEGORY_WEIGHTS);
  const brand = pick(BRANDS);
  const page = pick(PAGES);
  const allowed = FUNCTION_FOR[category];
  const [reviewer, fn] = pick(REVIEWERS.filter(([, f]) => !allowed || allowed.includes(f)));
  let comment = pick(TEMPLATES[category])
    .replaceAll('{brand}', brand)
    .replaceAll('{page}', page)
    .replaceAll('{n}', String(40 + Math.floor(rand() * 45)));
  // A few comments carry contact details, to test redaction.
  if (i % 50 === 7)
    comment += ' Questions: jordan.reyes@fictionalpharma.example or +1 555-010-0199.';
  const id = `C-${String(i).padStart(4, '0')}`;
  rows.push({
    'Proof Name': `${brand} ${pick(['HCP', 'Patient'])} Website – ${page}`,
    Version: `v${1 + Math.floor(rand() * 4)}`,
    Page: String(PAGES.indexOf(page) + 1),
    'Comment ID': id,
    Comment: comment,
    Reviewer: reviewer,
    'Reviewer Function': fn,
    Status: weighted([
      ['Resolved', 45],
      ['Accepted', 20],
      ['Open', 20],
      ['Rejected', 15],
    ] as [string, number][]),
    Date: new Date(start + Math.floor(rand() * ((end - start) / 86_400_000)) * 86_400_000),
    Brand: brand,
    Country: weighted([
      ['US', 55],
      ['CA', 15],
      ['GB', 15],
      ['DE', 15],
    ] as [string, number][]),
  });
  labels[id] = category;
}

// Deliberately messy rows the importer must report, not import.
const messy: [number, (r: Row) => void][] = [
  [20, (r) => (r.Comment = '')],
  [45, (r) => (r.Date = '2025-02-31')],
  [80, (r) => (r.Status = 'Pending?')],
  [110, (r) => (r.Brand = '')],
];
for (const [n, mutate] of messy) {
  mutate(rows[n - 1]!);
  labels[rows[n - 1]!['Comment ID'] as string] = 'invalid';
}
// An exact duplicate of row 10 (exports sometimes repeat rows); replaces the last row.
rows[COUNT - 1] = { ...rows[9]! };
labels[`C-${String(COUNT).padStart(4, '0')}`] = 'duplicate';

const iso = (d: string | Date) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

await mkdir(OUT, { recursive: true });
const wb = new ExcelJS.Workbook();
wb.creator = 'Pre-MLR Checker synthetic data generator';
wb.created = new Date(Date.UTC(2026, 9, 3));
wb.modified = wb.created;
const ws = wb.addWorksheet('Comments');
ws.addRow([...HEADERS]).font = { bold: true };
for (const r of rows) ws.addRow(HEADERS.map((h) => r[h]));
ws.getColumn(HEADERS.indexOf('Date') + 1).numFmt = 'yyyy-mm-dd';
ws.columns.forEach((c, i) => (c.width = [36, 8, 6, 10, 70, 18, 18, 10, 12, 10, 8][i]));
await wb.xlsx.writeFile(join(OUT, 'synthetic-mlr-comments.xlsx'));

const csvCell = (v: string | Date) => {
  const s = iso(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const csv =
  [HEADERS.join(','), ...rows.map((r) => HEADERS.map((h) => csvCell(r[h])).join(','))].join('\n') +
  '\n';
await writeFile(join(OUT, 'synthetic-mlr-comments.csv'), csv);
await writeFile(
  join(OUT, 'synthetic-mlr-comments.labels.json'),
  `${JSON.stringify(labels, null, 2)}\n`,
);

const counts = Object.values(labels).reduce<Record<string, number>>(
  (m, c) => ((m[c] = (m[c] ?? 0) + 1), m),
  {},
);
console.log(`Wrote ${rows.length} rows to ${OUT}`);
console.log(counts);
