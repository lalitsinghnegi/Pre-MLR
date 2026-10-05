import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tokenize } from './clusters.js';
export function cosine(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++)
        dot += a[i] * (b[i] ?? 0);
    return dot;
}
function unit(v) {
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return n ? v.map((x) => x / n) : v;
}
/**
 * Lexical stand-in: hashes words and word pairs into a fixed-size vector. Deterministic, offline
 * and instant, for tests and as a fallback; it matches shared wording, not meaning.
 */
export class HashEmbedder {
    dimensions;
    id = 'hash-v1';
    minSimilarity = 0.2;
    constructor(dimensions = 512) {
        this.dimensions = dimensions;
    }
    async embed(texts) {
        return texts.map((text) => {
            const v = new Array(this.dimensions).fill(0);
            const words = tokenize(text);
            const features = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
            for (const f of features) {
                const h = createHash('sha256').update(f).digest();
                // One bucket per feature, with a hash-derived sign so collisions tend to cancel out.
                v[h.readUInt32BE(0) % this.dimensions] += h[4] & 1 ? 1 : -1;
            }
            return unit(v);
        });
    }
}
async function loadPipeline(model, cacheDir) {
    const { env, pipeline } = await import('@huggingface/transformers');
    env.cacheDir = cacheDir;
    const extractor = await pipeline('feature-extraction', model, { dtype: LocalEmbedder.dtype });
    return extractor;
}
/**
 * A small sentence-embedding model run in-process with transformers.js (ONNX, 8-bit). The model is
 * downloaded from Hugging Face on first use into `cacheDir`, then loaded from disk; text is never
 * sent anywhere.
 */
export class LocalEmbedder {
    model;
    cacheDir;
    batchSize;
    loadModel;
    id;
    minSimilarity = 0.4;
    /** 8-bit weights: about a quarter of the fp32 download (~23 MB) with near-identical vectors. */
    static dtype = 'q8';
    extractor = null;
    constructor(model, cacheDir, batchSize = 32, 
    /** Loads the model; tests pass a fake so nothing is downloaded. */
    loadModel = loadPipeline) {
        this.model = model;
        this.cacheDir = cacheDir;
        this.batchSize = batchSize;
        this.loadModel = loadModel;
        this.id = `local:${model}#${LocalEmbedder.dtype}`;
    }
    load() {
        this.extractor ??= this.loadModel(this.model, this.cacheDir).catch((err) => {
            this.extractor = null; // allow a retry (e.g. after a network blip during download)
            throw err;
        });
        return this.extractor;
    }
    async embed(texts) {
        if (!texts.length)
            return [];
        const extractor = await this.load();
        const out = [];
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
export function createEmbedder(config) {
    switch (config.EMBEDDINGS) {
        case 'none':
            return null;
        case 'hash':
            return new HashEmbedder();
        case 'local':
            return new LocalEmbedder(config.EMBEDDING_MODEL, join(resolve(config.DATA_DIR), 'models'));
    }
}
//# sourceMappingURL=embed.js.map