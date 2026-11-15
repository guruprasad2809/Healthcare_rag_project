// Lightweight stand-ins for the heavy models and the LLM, so tests run in seconds
// without downloading weights or calling paid APIs.
import { tokenize, termId } from '../../src/retrieval/bm25Encoder.js';

/** Bag-of-words hashing embedder: texts that share words get similar vectors. */
export class FakeEmbedder {
  constructor(dimension = 256) {
    this.dimension = dimension;
    this.ready = true;
  }
  async init() {}
  vector(text) {
    const v = new Array(this.dimension).fill(0);
    for (const token of tokenize(text)) v[termId(token) % this.dimension] += 1;
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
  async embedDocuments(texts) { return texts.map((t) => this.vector(t)); }
  async embedQuery(query) { return this.vector(query); }
}

/** Word-overlap reranker: score = share of query words found in the passage. */
export class FakeReranker {
  constructor() { this.ready = true; }
  async init() {}
  async rerank(query, candidates, { topK = candidates.length, minScore = 0 } = {}) {
    const wanted = new Set(tokenize(query));
    return candidates
      .map((c) => {
        const have = new Set(tokenize(c.rerankText || c.text));
        const hits = [...wanted].filter((t) => have.has(t)).length;
        return { ...c, rerankScore: wanted.size ? hits / wanted.size : 0 };
      })
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .filter((c) => c.rerankScore >= minScore)
      .slice(0, topK);
  }
}

/** Echo LLM: records the prompt and returns a canned answer. */
export class FakeLlm {
  constructor() { this.configured = true; this.calls = []; }
  async generate(request) {
    this.calls.push(request);
    return 'Test answer [1].';
  }
}
