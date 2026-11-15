import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { SUPPORTED_EXTENSIONS } from '../../ingestion/parsers/index.js';

export function healthRoutes({ store, embedder, reranker, llm, registry, config }) {
  const router = Router();
  router.get('/', asyncHandler(async (req, res) => {
    const qdrant = await store.isHealthy();
    res.json({
      status: qdrant && embedder.ready && reranker.ready && llm.configured ? 'ready' : 'starting',
      qdrant,
      embeddingModelReady: embedder.ready,
      rerankerReady: reranker.ready,
      llmConfigured: llm.configured,
      models: { llm: config.llm.model, embedding: config.embedding.model, reranker: config.reranker.enabled ? config.reranker.model : 'disabled' },
      documents: (await registry.list()).length,
      supportedFileTypes: SUPPORTED_EXTENSIONS,
    });
  }));
  return router;
}
