// Baseline chunkers, kept only to compare against semantic title-based chunking
// (see scripts/compareChunking.js and docs/CHUNKING_ANALYSIS.md).
import { estimateTokens } from '../../utils/text.js';

/** Flatten blocks to plain text, the way a structure-blind chunker sees a document. */
export const blocksToText = (blocks) => blocks.map((block) => block.text).join('\n\n');

const toChunk = (text) => ({ text, embeddingText: text, headingPath: [], sectionTitle: '', part: 1, partsTotal: 1, tokenEstimate: estimateTokens(text) });

/** Fixed-size chunking: cut every N characters with some overlap, ignoring all structure. */
export function fixedSizeChunk(blocks, { maxTokens = 450, overlapTokens = 50 } = {}) {
  const text = blocksToText(blocks);
  const size = maxTokens * 4;
  const step = size - overlapTokens * 4;
  const chunks = [];
  for (let start = 0; start < text.length; start += step) {
    const piece = text.slice(start, start + size).trim();
    if (piece) chunks.push(toChunk(piece));
    if (start + size >= text.length) break;
  }
  return chunks;
}

/**
 * Recursive character chunking: try to split on paragraphs, then lines, then
 * sentences, then words, and pack the pieces up to the size limit.
 */
export function recursiveChunk(blocks, { maxTokens = 450, overlapTokens = 50 } = {}) {
  const separators = ['\n\n', '\n', '. ', ' '];
  const limit = maxTokens * 4;

  const split = (text, depth) => {
    if (text.length <= limit) return [text];
    if (depth >= separators.length) return text.match(new RegExp(`[\\s\\S]{1,${limit}}`, 'g')) || [];
    const separator = separators[depth];
    return text.split(separator).flatMap((part, i, all) => split(i < all.length - 1 && separator === '. ' ? `${part}.` : part, depth + 1));
  };

  const pieces = split(blocksToText(blocks), 0).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 1 > limit) {
      chunks.push(toChunk(current));
      current = current.slice(-overlapTokens * 4); // carry a little overlap forward
    }
    current = current ? `${current} ${piece}` : piece;
  }
  if (current.trim()) chunks.push(toChunk(current.trim()));
  return chunks;
}
