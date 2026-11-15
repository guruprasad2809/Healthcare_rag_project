// Ingestion pipeline: file -> parse -> preprocess -> metadata -> chunk -> embed -> store.
import crypto from 'node:crypto';
import { parseDocument } from './parsers/index.js';
import { preprocessBlocks } from './preprocess.js';
import { extractMetadata } from './metadata.js';
import { chunkDocument } from './chunking/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ingestion');

/** Deterministic UUID for a chunk, so re-ingesting a file overwrites its old points. */
const chunkId = (docId, index) => {
  const hex = crypto.createHash('sha256').update(`${docId}:${index}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

export class IngestionPipeline {
  /**
   * @param {{embedder, bm25, store, registry}} services
   * @param {{maxTokens, minTokens, mergeTargetTokens, semanticSplit}} chunking
   */
  constructor({ embedder, bm25, store, registry }, chunking) {
    this.embedder = embedder;
    this.bm25 = bm25;
    this.store = store;
    this.registry = registry;
    this.chunking = chunking;
  }

  /** Parse and chunk only (no models needed for parsing; used by tests and the comparison script). */
  async prepare(fileName, buffer, { strategy = 'semantic-title', embedder = this.embedder } = {}) {
    const parsed = await parseDocument(fileName, buffer);
    parsed.blocks = preprocessBlocks(parsed.blocks);
    if (!parsed.blocks.some((block) => block.type !== 'heading')) {
      const error = new Error(`No readable text found in ${fileName}. Scanned PDFs need OCR first.`);
      error.status = 422;
      throw error;
    }
    const metadata = extractMetadata(fileName, buffer, parsed);
    const chunks = await chunkDocument(parsed.blocks, { ...this.chunking, docTitle: metadata.title, embedder }, strategy);
    return { metadata, chunks, blocks: parsed.blocks };
  }

  /** Full ingestion of one file. Returns the document record saved in the registry. */
  async ingest(fileName, buffer) {
    const started = Date.now();
    const { metadata, chunks } = await this.prepare(fileName, buffer);

    const vectors = await this.embedder.embedDocuments(chunks.map((chunk) => chunk.embeddingText));
    await this.store.ensureCollection(vectors[0].length);
    await this.store.deleteDocument(metadata.docId); // replace any earlier version of the same file

    const points = chunks.map((chunk, index) => ({
      id: chunkId(metadata.docId, index),
      dense: vectors[index],
      sparse: this.bm25.encodeDocument(chunk.embeddingText),
      payload: {
        doc_id: metadata.docId,
        file_name: metadata.fileName,
        file_type: metadata.fileType,
        doc_title: metadata.title,
        heading_path: chunk.headingPath,
        section_title: chunk.sectionTitle,
        page: chunk.page ?? null,
        chunk_index: index,
        part: chunk.part,
        parts_total: chunk.partsTotal,
        token_estimate: chunk.tokenEstimate,
        text: chunk.text,
      },
    }));
    await this.store.upsert(points);

    const record = { ...metadata, chunkCount: chunks.length, ingestSeconds: Number(((Date.now() - started) / 1000).toFixed(1)) };
    await this.registry.put(record);
    log.info(`Ingested ${metadata.fileName}: ${chunks.length} chunks in ${record.ingestSeconds}s`);
    return record;
  }

  async remove(docId) {
    await this.store.deleteDocument(docId);
    return this.registry.remove(docId);
  }
}
