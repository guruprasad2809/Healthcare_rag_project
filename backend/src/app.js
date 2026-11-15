// Express application: REST API under /api, static frontend at /.
import express from 'express';
import cors from 'cors';
import { documentRoutes } from './api/routes/documents.routes.js';
import { chatRoutes } from './api/routes/chat.routes.js';
import { healthRoutes } from './api/routes/health.routes.js';
import { errorHandler, notFound } from './api/middleware/errorHandler.js';

export function createApp(container) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRoutes(container));
  app.use('/api/documents', documentRoutes(container));
  app.use('/api', chatRoutes(container));
  app.use('/api', notFound);

  app.use(express.static(container.config.server.frontendDir));
  app.use(errorHandler);
  return app;
}
