import type { Config } from '../config.js';
/** Turns text into unit-length vectors, so cosine similarity is a dot product. */
export interface Embedder {
    /** Stored with each vector; vectors from different embedders are never compared. */
    readonly id: string;
    /** Below this cosine similarity a precedent is not attached (scales differ per embedder). */
    readonly minSimilarity: number;
    embed(texts: string[]): Promise<number[][]>;
}
export declare function cosine(a: number[], b: number[]): number;
/**
 * Lexical stand-in: hashes words and word pairs into a fixed-size vector. Deterministic, offline
 * and instant, for tests and as a fallback; it matches shared wording, not meaning.
 */
export declare class HashEmbedder implements Embedder {
    private readonly dimensions;
    readonly id = "hash-v1";
    readonly minSimilarity = 0.2;
    constructor(dimensions?: number);
    embed(texts: string[]): Promise<number[][]>;
}
export type Extractor = (texts: string[], opts: {
    pooling: 'mean';
    normalize: true;
}) => Promise<{
    tolist(): number[][];
}>;
/**
 * A small sentence-embedding model run in-process with transformers.js (ONNX, 8-bit). The model is
 * downloaded from Hugging Face on first use into `cacheDir`, then loaded from disk; text is never
 * sent anywhere.
 */
export declare class LocalEmbedder implements Embedder {
    private readonly model;
    private readonly cacheDir;
    private readonly batchSize;
    /** Loads the model; tests pass a fake so nothing is downloaded. */
    private readonly loadModel;
    readonly id: string;
    readonly minSimilarity = 0.4;
    /** 8-bit weights: about a quarter of the fp32 download (~23 MB) with near-identical vectors. */
    static readonly dtype = "q8";
    private extractor;
    constructor(model: string, cacheDir: string, batchSize?: number, 
    /** Loads the model; tests pass a fake so nothing is downloaded. */
    loadModel?: (model: string, cacheDir: string) => Promise<Extractor>);
    private load;
    embed(texts: string[]): Promise<number[][]>;
}
/** The configured embedder, or null when retrieval is off (EMBEDDINGS=none). */
export declare function createEmbedder(config: Config): Embedder | null;
