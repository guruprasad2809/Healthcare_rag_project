// Qdrant vector store. One collection holds, for every chunk:
//   - a dense vector  ("dense")  from Qwen3-Embedding  -> semantic search
//   - a sparse vector ("bm25")   from the BM25 encoder -> keyword search
// Hybrid search runs both and fuses the two result lists inside Qdrant.
import { QdrantClient } from '@qdrant/js-client-rest';
import { createLogger } from '../utils/logger.js';

const log = createLogger('qdrant');
const DENSE = 'dense';
const SPARSE = 'bm25';

export class QdrantStore {
  /** @param {{url: string, apiKey?: string, collection: string}} options */
  constructor(options, { client } = {}) {
    this.collection = options.collection;
    this.client = client || new QdrantClient({ url: options.url, apiKey: options.apiKey, checkCompatibility: false });
  }

  async isHealthy() {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }

  /** Create the collection (dense + sparse vectors) if it does not exist yet. */
  async ensureCollection(dimension) {
    const { exists } = await this.client.collectionExists(this.collection);
    if (exists) return;
    await this.client.createCollection(this.collection, {
      vectors: { [DENSE]: { size: dimension, distance: 'Cosine' } },
      sparse_vectors: { [SPARSE]: { modifier: 'idf' } },
    });
    await this.client.createPayloadIndex(this.collection, { field_name: 'doc_id', field_schema: 'keyword' });
    log.info(`Created collection "${this.collection}" (dense ${dimension}d + BM25 sparse)`);
  }

  /** @param {Array<{id: string, dense: number[], sparse: {indices: number[], values: number[]}, payload: object}>} points */
  async upsert(points, batchSize = 64) {
    for (let i = 0; i < points.length; i += batchSize) {
      await this.client.upsert(this.collection, {
        wait: true,
        points: points.slice(i, i + batchSize).map((point) => ({
          id: point.id,
          vector: { [DENSE]: point.dense, [SPARSE]: point.sparse },
          payload: point.payload,
        })),
      });
    }
  }

  async deleteDocument(docId) {
    await this.client.delete(this.collection, {
      wait: true,
      filter: { must: [{ key: 'doc_id', match: { value: docId } }] },
    });
  }

  async count(docId) {
    const filter = docId ? { must: [{ key: 'doc_id', match: { value: docId } }] } : undefined;
    const { count } = await this.client.count(this.collection, { filter, exact: true });
    return count;
  }

  /**
   * Hybrid search: BM25 and dense candidates are fetched separately, then merged with
   * Reciprocal Rank Fusion (RRF), which rewards chunks ranked well by either method.
   * @param {{dense: number[], sparse: {indices: number[], values: number[]}, limit: number, docIds?: string[], mode?: 'hybrid'|'dense'|'bm25'}} query
   */
  async hybridSearch({ dense, sparse, limit, docIds, mode = 'hybrid' }) {
    const filter = docIds?.length ? { must: [{ key: 'doc_id', match: { any: docIds } }] } : undefined;
    const denseQuery = { query: dense, using: DENSE, limit, filter };
    const sparseQuery = { query: sparse, using: SPARSE, limit, filter };

    let request;
    if (mode === 'dense') request = { ...denseQuery, with_payload: true };
    else if (mode === 'bm25' || !dense) request = { ...sparseQuery, with_payload: true };
    else if (!sparse.indices.length) request = { ...denseQuery, with_payload: true };
    else request = { prefetch: [denseQuery, sparseQuery], query: { fusion: 'rrf' }, limit, with_payload: true };

    const { points } = await this.client.query(this.collection, request);
    return points.map((point) => ({ id: point.id, score: point.score, payload: point.payload }));
  }
}
