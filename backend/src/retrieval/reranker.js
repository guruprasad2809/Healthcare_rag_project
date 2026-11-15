// Reranker: BAAI/bge-reranker-v2-m3, a cross-encoder. Unlike the embedding model it
// reads the question and a passage together, so it judges relevance far more precisely.
// It is slower, which is why it only re-scores the short list from hybrid search.
import { createLogger } from '../utils/logger.js';

const log = createLogger('reranker');
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

export class Reranker {
  /**
   * @param {{enabled: boolean, model: string, dtype: string, batchSize: number, maxLength: number}} options
   * @param {{cacheDir?: string, loader?: Function}} runtime
   */
  constructor(options, runtime = {}) {
    this.options = options;
    this.runtime = runtime;
    this.tokenizer = null;
    this.model = null;
    this.loading = null;
  }

  get ready() {
    return !this.options.enabled || this.model !== null;
  }

  async init() {
    if (!this.options.enabled || this.model) return;
    if (!this.loading) {
      this.loading = (async () => {
        log.info(`Loading reranker ${this.options.model} (${this.options.dtype})... first run downloads the weights`);
        const loader = this.runtime.loader || defaultLoader;
        ({ tokenizer: this.tokenizer, model: this.model } = await loader(this.options, this.runtime));
        log.info('Reranker ready');
      })().catch((cause) => {
        this.loading = null;
        throw Object.assign(new Error(`Could not load the reranker ${this.options.model}: ${cause.message}`), { status: 503 });
      });
    }
    await this.loading;
  }

  /** Relevance score in [0, 1] for every (query, passage) pair. */
  async score(query, passages) {
    await this.init();
    const scores = [];
    const size = this.options.batchSize;
    for (let i = 0; i < passages.length; i += size) {
      const batch = passages.slice(i, i + size);
      // Pad the last batch to full size: some ONNX exports have a fixed batch dimension.
      const padded = [...batch];
      while (padded.length < size) padded.push(batch[batch.length - 1]);
      const inputs = this.tokenizer(padded.map(() => query), {
        text_pair: padded,
        padding: true,
        truncation: true,
        max_length: this.options.maxLength,
      });
      const { logits } = await this.model(inputs);
      const values = logits.tolist().map((row) => sigmoid(Array.isArray(row) ? row[0] : row));
      scores.push(...values.slice(0, batch.length));
    }
    return scores;
  }

  /**
   * Re-order candidates by cross-encoder relevance.
   * @param {string} query
   * @param {Array<{text: string}>} candidates  each needs the passage text; `rerankText` is used when present
   * @returns {Promise<Array>} candidates with `rerankScore`, best first
   */
  async rerank(query, candidates, { topK = candidates.length, minScore = 0 } = {}) {
    if (!candidates.length) return [];
    if (!this.options.enabled) return candidates.slice(0, topK).map((c) => ({ ...c, rerankScore: null }));
    const scores = await this.score(query, candidates.map((c) => c.rerankText || c.text));
    return candidates
      .map((candidate, i) => ({ ...candidate, rerankScore: scores[i] }))
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .filter((candidate) => candidate.rerankScore >= minScore)
      .slice(0, topK);
  }
}

async function defaultLoader(options, { cacheDir }) {
  const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import('@huggingface/transformers');
  if (cacheDir) env.cacheDir = cacheDir;
  const tokenizer = await AutoTokenizer.from_pretrained(options.model);
  const model = await AutoModelForSequenceClassification.from_pretrained(options.model, { dtype: options.dtype });
  return { tokenizer, model };
}
