// Express application: REST API under /api, static frontend at /.
import express from 'express';
import cors from 'cors';
import { documentRoutes } from './api/routes/documents.routes.js';
import { chatRoutes } from './api/routes/chat.routes.js';
import { healthRoutes } from './api/routes/health.routes.js';
import { evaluationRoutes } from './api/routes/evaluation.routes.js';
import { errorHandler, notFound } from './api/middleware/errorHandler.js';
import { basicAuth } from './api/middleware/auth.js';

export function createApp(container) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // Health stays open so uptime checks work; everything else needs the password when one is set.
  app.use('/api/health', healthRoutes(container));
  app.use(basicAuth(container.config.server.auth));
  app.use('/api/documents', documentRoutes(container));
  app.use('/api/evaluation', evaluationRoutes(container));
  app.use('/api', chatRoutes(container));
  app.use('/api', notFound);

  app.use(express.static(container.config.server.frontendDir));
  app.use(errorHandler);
  return app;
}
