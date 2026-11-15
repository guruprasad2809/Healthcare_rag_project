// Central configuration. Every tunable value is read from the environment here,
// so the rest of the code never touches process.env directly.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../../..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

const str = (name, fallback = '') => (process.env[name] ?? '').trim() || fallback;
const num = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== '' && process.env[name] !== undefined ? value : fallback;
};
const bool = (name, fallback) => {
  const value = (process.env[name] ?? '').trim().toLowerCase();
  return value === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(value);
};
const resolveFromRoot = (p) => (path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p));

export function loadConfig() {
  const storageDir = resolveFromRoot(str('STORAGE_DIR', './storage'));
  return {
    server: {
      port: num('PORT', 3000),
      maxUploadBytes: num('MAX_UPLOAD_MB', 25) * 1024 * 1024,
      frontendDir: path.join(PROJECT_ROOT, 'frontend'),
    },
    llm: {
      apiKey: str('GEMINI_API_KEY'),
      model: str('GEMINI_MODEL', 'gemini-3.8-flash'),
      temperature: num('GEMINI_TEMPERATURE', 0.2),
      maxOutputTokens: num('GEMINI_MAX_OUTPUT_TOKENS', 1024),
    },
    embedding: {
      model: str('EMBEDDING_MODEL', 'onnx-community/Qwen3-Embedding-0.6B-ONNX'),
      dtype: str('EMBEDDING_DTYPE', 'q8'),
      dim: num('EMBEDDING_DIM', 1024),
      batchSize: num('EMBEDDING_BATCH_SIZE', 8),
      queryInstruction: str(
        'EMBEDDING_QUERY_INSTRUCTION',
        'Given a healthcare question, retrieve passages from medical documents that answer the question',
      ),
    },
    reranker: {
      enabled: bool('RERANKER_ENABLED', true),
      model: str('RERANKER_MODEL', 'onnx-community/bge-reranker-v2-m3-ONNX'),
      dtype: str('RERANKER_DTYPE', 'q8'),
      batchSize: num('RERANKER_BATCH_SIZE', 8),
      maxLength: num('RERANKER_MAX_LENGTH', 512),
    },
    qdrant: {
      url: str('QDRANT_URL', 'http://localhost:6333'),
      apiKey: str('QDRANT_API_KEY') || undefined,
      collection: str('QDRANT_COLLECTION', 'healthcare_docs'),
    },
    chunking: {
      maxTokens: num('CHUNK_MAX_TOKENS', 450),
      minTokens: num('CHUNK_MIN_TOKENS', 40),
      mergeTargetTokens: num('CHUNK_MERGE_TARGET_TOKENS', 200),
      semanticSplit: bool('CHUNK_SEMANTIC_SPLIT', true),
    },
    retrieval: {
      candidates: num('RETRIEVAL_CANDIDATES', 20),
      topK: num('RERANK_TOP_K', 5),
      minScore: num('RERANK_MIN_SCORE', 0.02),
    },
    storage: {
      dir: storageDir,
      modelCacheDir: resolveFromRoot(str('MODEL_CACHE_DIR', path.join(storageDir, 'models'))),
    },
    hfToken: str('HF_TOKEN') || undefined,
  };
}
