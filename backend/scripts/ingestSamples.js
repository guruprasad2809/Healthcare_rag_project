// Ingest every file in data/sample_documents (or a folder you pass in) into Qdrant.
// Usage: npm run ingest:samples            (from backend/)
//        node scripts/ingestSamples.js /path/to/folder
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, PROJECT_ROOT } from '../src/config/index.js';
import { createContainer } from '../src/services/container.js';
import { isSupported } from '../src/ingestion/parsers/index.js';

const folder = path.resolve(process.argv[2] || path.join(PROJECT_ROOT, 'data/sample_documents'));
const config = loadConfig();
fs.mkdirSync(config.storage.modelCacheDir, { recursive: true });
const { ingestion, store } = createContainer(config);

if (!(await store.isHealthy())) {
  console.error(`Qdrant is not reachable at ${config.qdrant.url}. Start it with: docker compose up -d`);
  process.exit(1);
}

const files = fs.readdirSync(folder).filter(isSupported).sort();
console.log(`Ingesting ${files.length} files from ${folder}\n`);
let chunks = 0;
for (const file of files) {
  try {
    const record = await ingestion.ingest(file, fs.readFileSync(path.join(folder, file)));
    chunks += record.chunkCount;
    console.log(`  ok      ${file.padEnd(48)} ${String(record.chunkCount).padStart(4)} chunks  ${record.ingestSeconds}s`);
  } catch (error) {
    console.log(`  FAILED  ${file.padEnd(48)} ${error.message}`);
  }
}
console.log(`\nDone: ${chunks} chunks in collection "${config.qdrant.collection}".`);
