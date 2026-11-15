// Retriever: hybrid search (BM25 + vectors, fused with RRF) followed by reranking.
export class Retriever {
  /**
   * @param {{embedder, bm25, store, reranker}} services
   * @param {{candidates: number, topK: number, minScore: number}} settings
   */
  constructor({ embedder, bm25, store, reranker }, settings) {
    this.embedder = embedder;
    this.bm25 = bm25;
    this.store = store;
    this.reranker = reranker;
    this.settings = settings;
  }

  /**
   * @param {string} query
   * @param {{topK?: number, docIds?: string[], mode?: 'hybrid'|'dense'|'bm25', rerank?: boolean}} options
   * @returns {Promise<{chunks: Array, timings: object}>}
   */
  async retrieve(query, options = {}) {
    const { topK = this.settings.topK, docIds, mode = 'hybrid', rerank = true } = options;
    const timings = {};
    let mark = Date.now();
    const lap = (name) => { timings[name] = Date.now() - mark; mark = Date.now(); };

    // 1. Encode the query both ways.
    const dense = mode === 'bm25' ? null : await this.embedder.embedQuery(query);
    const sparse = this.bm25.encodeQuery(query);
    lap('embedMs');

    // 2. Hybrid search in Qdrant.
    const hits = await this.store.hybridSearch({ dense, sparse, limit: this.settings.candidates, docIds, mode });
    lap('searchMs');

    const candidates = hits.map((hit, index) => {
      const breadcrumb = [hit.payload.doc_title, ...(hit.payload.heading_path || [])].filter(Boolean).join(' > ');
      return {
        id: hit.id,
        text: hit.payload.text,
        rerankText: breadcrumb ? `${breadcrumb}\n${hit.payload.text}` : hit.payload.text,
        fusionScore: hit.score,
        fusionRank: index + 1,
        metadata: {
          docId: hit.payload.doc_id,
          fileName: hit.payload.file_name,
          fileType: hit.payload.file_type,
          docTitle: hit.payload.doc_title,
          headingPath: hit.payload.heading_path || [],
          sectionTitle: hit.payload.section_title,
          page: hit.payload.page,
          chunkIndex: hit.payload.chunk_index,
        },
      };
    });

    // 3. Rerank the short list with the cross-encoder and keep the best few.
    const chunks = rerank
      ? await this.reranker.rerank(query, candidates, { topK, minScore: this.settings.minScore })
      : candidates.slice(0, topK).map((c) => ({ ...c, rerankScore: null }));
    lap('rerankMs');

    return { chunks: chunks.map(({ rerankText, ...chunk }) => chunk), timings };
  }
}
