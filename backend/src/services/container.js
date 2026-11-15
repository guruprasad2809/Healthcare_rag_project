// Composition root: builds every service once and wires them together.
// Tests pass `overrides` to swap real models/Qdrant/Gemini for lightweight fakes.
import { Embedder } from './embedder.js';
import { QdrantStore } from './qdrantStore.js';
import { DocumentRegistry } from './documentRegistry.js';
import { RagPipeline } from './ragPipeline.js';
import { Bm25Encoder } from '../retrieval/bm25Encoder.js';
import { Reranker } from '../retrieval/reranker.js';
import { Retriever } from '../retrieval/retriever.js';
import { IngestionPipeline } from '../ingestion/ingestionPipeline.js';
import { GeminiClient } from '../generation/geminiClient.js';

export function createContainer(config, overrides = {}) {
  const runtime = { cacheDir: config.storage.modelCacheDir, hfToken: config.hfToken };

  const embedder = overrides.embedder || new Embedder(config.embedding, runtime);
  const reranker = overrides.reranker || new Reranker(config.reranker, runtime);
  const store = overrides.store || new QdrantStore(config.qdrant);
  const registry = overrides.registry || new DocumentRegistry(config.storage.dir);
  const llm = overrides.llm || new GeminiClient(config.llm);
  const bm25 = overrides.bm25 || new Bm25Encoder({ avgDocLength: config.chunking.mergeTargetTokens });

  const ingestion = new IngestionPipeline({ embedder, bm25, store, registry }, config.chunking);
  const retriever = new Retriever({ embedder, bm25, store, reranker }, config.retrieval);
  const rag = new RagPipeline({ retriever, llm });

  return { config, embedder, reranker, store, registry, llm, bm25, ingestion, retriever, rag };
}
