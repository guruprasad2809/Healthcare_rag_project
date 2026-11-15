// Embedding service: Qwen3-Embedding-0.6B running locally through Transformers.js (ONNX).
// Queries get an instruction prefix, documents do not - this is how the model was trained.
import { createLogger } from '../utils/logger.js';

const log = createLogger('embedder');

export class Embedder {
  /**
   * @param {{model: string, dtype: string, dim: number, batchSize: number, queryInstruction: string}} options
   * @param {{cacheDir?: string, hfToken?: string, pipelineFactory?: Function}} runtime
   */
  constructor(options, runtime = {}) {
    this.options = options;
    this.runtime = runtime;
    this.dimension = options.dim;
    this.extractor = null;
    this.loading = null;
  }

  get ready() {
    return this.extractor !== null;
  }

  /** Load the model once; concurrent callers share the same promise. */
  async init() {
    if (this.extractor) return;
    if (!this.loading) {
      this.loading = (async () => {
        log.info(`Loading embedding model ${this.options.model} (${this.options.dtype})... first run downloads the weights`);
        const factory = this.runtime.pipelineFactory || (await defaultPipelineFactory(this.runtime));
        this.extractor = await factory('feature-extraction', this.options.model, { dtype: this.options.dtype });
        log.info('Embedding model ready');
      })().catch((cause) => {
        this.loading = null;
        throw Object.assign(new Error(`Could not load the embedding model ${this.options.model}: ${cause.message}`), { status: 503 });
      });
    }
    await this.loading;
  }

  async embed(texts) {
    await this.init();
    const vectors = [];
    for (let i = 0; i < texts.length; i += this.options.batchSize) {
      const batch = texts.slice(i, i + this.options.batchSize);
      // Qwen3-Embedding uses the last token as the sentence embedding.
      const output = await this.extractor(batch, { pooling: 'last_token', normalize: true });
      vectors.push(...output.tolist());
    }
    return vectors;
  }

  /** Embed passages/chunks (no instruction prefix). */
  embedDocuments(texts) {
    return this.embed(texts);
  }

  /** Embed a search query (with the task instruction prefix). */
  async embedQuery(query) {
    const [vector] = await this.embed([`Instruct: ${this.options.queryInstruction}\nQuery:${query}`]);
    return vector;
  }
}

async function defaultPipelineFactory({ cacheDir, hfToken }) {
  const { pipeline, env } = await import('@huggingface/transformers');
  if (cacheDir) env.cacheDir = cacheDir;
  if (hfToken) process.env.HF_TOKEN = hfToken;
  return pipeline;
}
