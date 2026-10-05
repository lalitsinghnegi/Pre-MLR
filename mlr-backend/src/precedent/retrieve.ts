import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  findingPrecedents,
  findings,
  precedentClassifications,
  precedentEmbeddings,
  precedents,
  ruleVersions,
  scans,
} from '../db/schema.js';
import { cosine, type Embedder } from './embed.js';

export const TOP_K = 3;
/** Added to the similarity of a precedent for the scan's own brand or site. */
const BRAND_BOOST = 0.05;
const SITE_BOOST = 0.03;
/** Matches at least this similar to an already chosen one are treated as repeats. */
const NEAR_DUPLICATE = 0.95;

/** Embeds the given precedents that have no vector yet for this embedder; returns how many. */
export async function ensureEmbeddings(
  db: Db,
  embedder: Embedder,
  items: { id: string; text: string }[],
): Promise<number> {
  const have = new Set<string>();
  for (let i = 0; i < items.length; i += 500) {
    for (const r of db
      .select({ id: precedentEmbeddings.precedentId })
      .from(precedentEmbeddings)
      .where(
        and(
          eq(precedentEmbeddings.embedder, embedder.id),
          inArray(
            precedentEmbeddings.precedentId,
            items.slice(i, i + 500).map((x) => x.id),
          ),
        ),
      )
      .all()) {
      have.add(r.id);
    }
  }
  const missing = items.filter((x) => !have.has(x.id));
  if (!missing.length) return 0;
  const vectors = await embedder.embed(missing.map((x) => x.text));
  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (let i = 0; i < missing.length; i += 200) {
      tx.insert(precedentEmbeddings)
        .values(
          missing.slice(i, i + 200).map((x, j) => ({
            precedentId: x.id,
            embedder: embedder.id,
            vector: vectors[i + j]!.map((n) => Math.round(n * 1e6) / 1e6),
            createdAt: now,
          })),
        )
        .onConflictDoNothing()
        .run();
    }
  });
  return missing.length;
}

export interface AttachOptions {
  embedder: Embedder;
  maxAgeMonths: number;
  now?: Date;
}

export interface AttachResult {
  findings: number;
  /** Findings that got at least one precedent. */
  matched: number;
  attached: number;
  embedded: number;
}

/** YYYY-MM-DD, `months` before `now`. */
export function cutoffDate(now: Date, months: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

/**
 * Attaches up to three similar historic comments to each finding of a scan, as advisory evidence.
 * Candidates are precedents classified into the finding's rule category and commented within the
 * last `maxAgeMonths`; they are ranked by cosine similarity of sentence embeddings (finding: rule
 * title, message and evidence; precedent: comment text), nudged up for the scan's brand or site,
 * and dropped below the embedder's minimum similarity. Re-running replaces the scan's matches.
 */
export async function attachPrecedents(
  db: Db,
  scanId: string,
  opts: AttachOptions,
): Promise<AttachResult> {
  const scan = db.select().from(scans).where(eq(scans.id, scanId)).get();
  const rows = db
    .select({ f: findings, category: ruleVersions.category, ruleTitle: ruleVersions.title })
    .from(findings)
    .innerJoin(
      ruleVersions,
      and(eq(ruleVersions.ruleId, findings.ruleId), eq(ruleVersions.version, findings.ruleVersion)),
    )
    .where(eq(findings.scanId, scanId))
    .all();
  const result: AttachResult = { findings: rows.length, matched: 0, attached: 0, embedded: 0 };
  if (!scan || !rows.length) return result;

  const categories = [...new Set(rows.map((r) => r.category))];
  const candidates = db
    .select({ p: precedents, category: precedentClassifications.category })
    .from(precedents)
    .innerJoin(precedentClassifications, eq(precedentClassifications.precedentId, precedents.id))
    .where(
      and(
        eq(precedentClassifications.status, 'ok'),
        inArray(precedentClassifications.category, categories),
        gte(precedents.commentedAt, cutoffDate(opts.now ?? new Date(), opts.maxAgeMonths)),
      ),
    )
    .all();

  const attached: (typeof findingPrecedents.$inferInsert)[] = [];
  // No candidates means nothing to compare: the embedder (and any model download) is never touched.
  if (candidates.length) {
    const { embedder } = opts;
    result.embedded = await ensureEmbeddings(
      db,
      embedder,
      candidates.map(({ p }) => ({ id: p.id, text: p.commentText })),
    );
    const vectors = new Map<string, number[]>();
    const ids = candidates.map(({ p }) => p.id);
    for (let i = 0; i < ids.length; i += 500) {
      for (const r of db
        .select({ id: precedentEmbeddings.precedentId, v: precedentEmbeddings.vector })
        .from(precedentEmbeddings)
        .where(
          and(
            eq(precedentEmbeddings.embedder, embedder.id),
            inArray(precedentEmbeddings.precedentId, ids.slice(i, i + 500)),
          ),
        )
        .all()) {
        vectors.set(r.id, r.v);
      }
    }
    const queries = await embedder.embed(rows.map(queryText));
    const brands = new Set((scan.product?.brandNames ?? []).map((b) => b.toLowerCase()));
    const host = hostOf(scan.startUrl);
    const now = new Date().toISOString();

    rows.forEach((row, i) => {
      const q = queries[i]!;
      const ranked = candidates
        .filter((c) => c.category === row.category && vectors.has(c.p.id))
        .map(({ p }) => {
          const similarity = cosine(q, vectors.get(p.id)!);
          const boost =
            (brands.has(p.brand.toLowerCase()) ? BRAND_BOOST : 0) +
            (host && p.site && hostOf(p.site) === host ? SITE_BOOST : 0);
          return {
            id: p.id,
            gist: gistOf(p.commentText),
            similarity,
            score: similarity + boost,
            date: p.commentedAt,
          };
        })
        .filter((c) => c.similarity >= embedder.minSimilarity)
        // Ties (e.g. the same comment text on several proofs) go to the most recent.
        .sort(
          (a, b) => b.score - a.score || b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
        );
      // Repeats (the same comment on another proof, with another number, or with contact details
      // appended) add nothing: keep the best-ranked copy and look further down for something else.
      const chosen: typeof ranked = [];
      for (const c of ranked) {
        if (chosen.length === TOP_K) break;
        const v = vectors.get(c.id)!;
        const repeat = chosen.some(
          (x) =>
            x.gist.includes(c.gist) ||
            c.gist.includes(x.gist) ||
            cosine(v, vectors.get(x.id)!) >= NEAR_DUPLICATE,
        );
        if (!repeat) chosen.push(c);
      }
      if (chosen.length) result.matched++;
      chosen.forEach((c, rank) =>
        attached.push({
          findingId: row.f.id,
          precedentId: c.id,
          rank: rank + 1,
          similarity: Math.round(Math.max(0, Math.min(1, c.similarity)) * 1000) / 1000,
          embedder: embedder.id,
          createdAt: now,
        }),
      );
    });
  }

  db.transaction((tx) => {
    const findingIds = rows.map((r) => r.f.id);
    for (let i = 0; i < findingIds.length; i += 500) {
      tx.delete(findingPrecedents)
        .where(inArray(findingPrecedents.findingId, findingIds.slice(i, i + 500)))
        .run();
    }
    for (let i = 0; i < attached.length; i += 200) {
      tx.insert(findingPrecedents)
        .values(attached.slice(i, i + 200))
        .run();
    }
  });
  result.attached = attached.length;
  return result;
}

/** Comment wording without numbers, redaction placeholders or punctuation, for spotting repeats. */
export const gistOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/\[(email|phone)\]/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim();

const queryText = (r: { f: { message: string; evidenceText: string | null }; ruleTitle: string }) =>
  [r.ruleTitle, r.f.message, r.f.evidenceText]
    .map((s) => s?.trim().replace(/[.!?]$/, ''))
    .filter(Boolean)
    .join('. ');

function hostOf(s: string): string | null {
  try {
    return new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
