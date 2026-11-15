import { createLogger } from '../../utils/logger.js';

const log = createLogger('api');

/** Wrap async route handlers so rejected promises reach the error handler. */
export const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export const httpError = (status, message) => Object.assign(new Error(message), { status });

export function notFound(req, res) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  let status = error.status || 500;
  let message = error.message || 'Unexpected error';
  if (error.code === 'LIMIT_FILE_SIZE') { status = 413; message = 'File is too large.'; }
  if (!error.status && (error.code === 'ECONNREFUSED' || /fetch failed/i.test(message))) {
    status = 503;
    message = 'Cannot reach the vector database (Qdrant). Is it running? Try: docker compose up -d';
  }
  if (status >= 500) log.error(`${req.method} ${req.originalUrl} -> ${status}: ${error.message}`);
  res.status(status).json({ error: message });
}
