# Healthcare RAG: Node.js backend + static frontend in one image.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    ONNXRUNTIME_NODE_INSTALL_CUDA=skip

WORKDIR /app/backend

# Install dependencies first so this layer is cached between code changes.
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/src ./src
COPY backend/scripts ./scripts
COPY frontend /app/frontend
COPY data/sample_documents /app/data/sample_documents
COPY evaluation/datasets /app/evaluation/datasets

# storage/ holds the downloaded models and the document list; it is a volume in production.
RUN mkdir -p /app/storage /app/evaluation/results && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
