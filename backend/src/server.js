// Entry point: load config, build services, start the HTTP server.
import fs from 'node:fs';
import { loadConfig } from './config/index.js';
import { createContainer } from './services/container.js';
import { createApp } from './app.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('server');
const config = loadConfig();
fs.mkdirSync(config.storage.modelCacheDir, { recursive: true });

const container = createContainer(config);
const app = createApp(container);

app.listen(config.server.port, () => {
  log.info(`Healthcare RAG running at http://localhost:${config.server.port}`);
  log.info(`LLM: ${config.llm.model} | Embeddings: ${config.embedding.model} | Reranker: ${config.reranker.model}`);
  if (!config.llm.apiKey) log.warn('GEMINI_API_KEY is empty: uploads and retrieval work, but answers cannot be generated.');
});

// Warm the models in the background so the first request is not slow.
Promise.all([container.embedder.init(), container.reranker.init()]).catch((error) =>
  log.error(`Model loading failed: ${error.message}`),
);
container.store.isHealthy().then((ok) => {
  if (!ok) log.warn(`Qdrant is not reachable at ${config.qdrant.url}. Start it with: docker compose up -d`);
});
