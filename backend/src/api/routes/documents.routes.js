import { Router } from 'express';
import { asyncHandler, httpError } from '../middleware/errorHandler.js';
import { createUpload } from '../middleware/upload.js';

export function documentRoutes({ ingestion, registry, config }) {
  const router = Router();
  const upload = createUpload(config.server.maxUploadBytes);

  // List ingested documents.
  router.get('/', asyncHandler(async (req, res) => {
    res.json({ documents: await registry.list() });
  }));

  // Upload and ingest one or more files. Each file reports its own success or failure.
  router.post('/', upload.array('files'), asyncHandler(async (req, res) => {
    if (!req.files?.length) throw httpError(400, 'No files uploaded. Send them in the "files" form field.');
    const results = [];
    for (const file of req.files) {
      try {
        results.push({ fileName: file.originalname, status: 'ingested', document: await ingestion.ingest(file.originalname, file.buffer) });
      } catch (error) {
        results.push({ fileName: file.originalname, status: 'failed', error: error.message });
      }
    }
    const failed = results.filter((r) => r.status === 'failed').length;
    res.status(failed === results.length ? 422 : 201).json({ results });
  }));

  // Remove a document and all of its chunks.
  router.delete('/:docId', asyncHandler(async (req, res) => {
    const removed = await ingestion.remove(req.params.docId);
    if (!removed) throw httpError(404, 'Document not found.');
    res.json({ removed: true });
  }));

  return router;
}
