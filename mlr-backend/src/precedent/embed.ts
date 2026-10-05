import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { Config } from '../config.js';
import { tokenize } from './clusters.js';

/** Turns text into unit-length vectors, so cosine similarity is a dot product. */
export interface Embedder {
  /** Stored with each vector; vectors from different embedders are never compared. */
  readonly id: string;
  /** Below this cosine similarity a precedent is not attached (scales differ per embedder). */
  readonly minSimilarity: number;
  embed(texts: string[]): Promise<number[][]>;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * (b[i] ?? 0);
  return dot;
}

function unit(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n ? v.map((x) => x / n) : v;
}

/**
 * Lexical stand-in: hashes words and word pairs into a fixed-size vector. Deterministic, offline
 * and instant, for tests and as a fallback; it matches shared wording, not meaning.
 */
export class HashEmbedder implements Embedder {
  readonly id = 'hash-v1';
  readonly minSimilarity = 0.2;
  constructor(private readonly dimensions = 512) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(this.dimensions).fill(0);
      const words = tokenize(text);
      const features = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
      for (const f of features) {
        const h = createHash('sha256').update(f).digest();
        // One bucket per feature, with a hash-derived sign so collisions tend to cancel out.
        v[h.readUInt32BE(0) % this.dimensions]! += h[4]! & 1 ? 1 : -1;
      }
      return unit(v);
    });
  }
}

async function loadPipeline(model: string, cacheDir: string): Promise<Extractor> {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  const extractor = await pipeline('feature-extraction', model, { dtype: LocalEmbedder.dtype });
  return extractor as unknown as Extractor;
}

export type Extractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: true },
) => Promise<{ tolist(): number[][] }>;

/**
 * A small sentence-embedding model run in-process with transformers.js (ONNX, 8-bit). The model is
 * downloaded from Hugging Face on first use into `cacheDir`, then loaded from disk; text is never
 * sent anywhere.
 */
export class LocalEmbedder implements Embedder {
  readonly id: string;
  readonly minSimilarity = 0.4;
  /** 8-bit weights: about a quarter of the fp32 download (~23 MB) with near-identical vectors. */
  static readonly dtype = 'q8';
  private extractor: Promise<Extractor> | null = null;

  constructor(
    private readonly model: string,
    private readonly cacheDir: string,
    private readonly batchSize = 32,
    /** Loads the model; tests pass a fake so nothing is downloaded. */
    private readonly loadModel: (
      model: string,
      cacheDir: string,
    ) => Promise<Extractor> = loadPipeline,
  ) {
    this.id = `local:${model}#${LocalEmbedder.dtype}`;
  }

  private load(): Promise<Extractor> {
    this.extractor ??= this.loadModel(this.model, this.cacheDir).catch((err: unknown) => {
      this.extractor = null; // allow a retry (e.g. after a network blip during download)
      throw err;
    });
    return this.extractor;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const extractor = await this.load();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const tensor = await extractor(texts.slice(i, i + this.batchSize), {
        pooling: 'mean',
        normalize: true,
      });
      out.push(...tensor.tolist());
    }
    return out;
  }
}

/** The configured embedder, or null when retrieval is off (EMBEDDINGS=none). */
export function createEmbedder(config: Config): Embedder | null {
  switch (config.EMBEDDINGS) {
    case 'none':
      return null;
    case 'hash':
      return new HashEmbedder();
    case 'local':
      return new LocalEmbedder(config.EMBEDDING_MODEL, join(resolve(config.DATA_DIR), 'models'));
  }
}
