import { Router } from 'express';
import { asyncHandler, httpError } from '../middleware/errorHandler.js';

const readQuestion = (body, field) => {
  const value = typeof body?.[field] === 'string' ? body[field].trim() : '';
  if (!value) throw httpError(400, `"${field}" is required.`);
  if (value.length > 2000) throw httpError(400, `"${field}" is too long (max 2000 characters).`);
  return value;
};
const readOptions = (body) => ({
  topK: Number.isInteger(body.topK) && body.topK > 0 && body.topK <= 20 ? body.topK : undefined,
  docIds: Array.isArray(body.documentIds) && body.documentIds.length ? body.documentIds.map(String) : undefined,
});

export function chatRoutes({ rag, retriever }) {
  const router = Router();

  // Full RAG answer: retrieve, rerank, generate.
  router.post('/chat', asyncHandler(async (req, res) => {
    const question = readQuestion(req.body, 'question');
    res.json(await rag.ask(question, readOptions(req.body)));
  }));

  // Retrieval only (no LLM call): useful for debugging and for tuning retrieval.
  router.post('/retrieve', asyncHandler(async (req, res) => {
    const query = readQuestion(req.body, 'query');
    const mode = ['hybrid', 'dense', 'bm25'].includes(req.body.mode) ? req.body.mode : 'hybrid';
    res.json(await retriever.retrieve(query, { ...readOptions(req.body), mode, rerank: req.body.rerank !== false }));
  }));

  return router;
}
