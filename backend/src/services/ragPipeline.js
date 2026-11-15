// RAG pipeline: question -> retrieve (hybrid + rerank) -> prompt -> Gemini -> answer with sources.
import { SYSTEM_INSTRUCTION, buildPrompt } from '../generation/prompt.js';

export class RagPipeline {
  /** @param {{retriever, llm}} services */
  constructor({ retriever, llm }) {
    this.retriever = retriever;
    this.llm = llm;
  }

  /**
   * @param {string} question
   * @param {{topK?: number, docIds?: string[]}} options
   * @returns {Promise<{answer: string, sources: Array, contexts: string[], timings: object}>}
   */
  async ask(question, options = {}) {
    const { chunks, timings } = await this.retriever.retrieve(question, options);

    const started = Date.now();
    const answer = await this.llm.generate({ systemInstruction: SYSTEM_INSTRUCTION, prompt: buildPrompt(question, chunks) });
    timings.generateMs = Date.now() - started;

    return {
      answer,
      sources: chunks.map((chunk, index) => ({
        number: index + 1,
        fileName: chunk.metadata.fileName,
        fileType: chunk.metadata.fileType,
        docTitle: chunk.metadata.docTitle,
        headingPath: chunk.metadata.headingPath,
        page: chunk.metadata.page,
        rerankScore: chunk.rerankScore,
        fusionRank: chunk.fusionRank,
        text: chunk.text,
      })),
      // Plain context strings, in the shape RAGAS expects as "retrieved_contexts".
      contexts: chunks.map((chunk) => chunk.text),
      timings,
    };
  }
}
