// Chunking strategy registry. The app uses "semantic-title"; the others exist for comparison.
import { semanticTitleChunk } from './semanticTitleChunker.js';
import { fixedSizeChunk, recursiveChunk } from './baselineChunkers.js';

export const CHUNKERS = {
  'semantic-title': semanticTitleChunk,
  'fixed-size': async (blocks, options) => fixedSizeChunk(blocks, options),
  recursive: async (blocks, options) => recursiveChunk(blocks, options),
};

export async function chunkDocument(blocks, options = {}, strategy = 'semantic-title') {
  const chunker = CHUNKERS[strategy];
  if (!chunker) throw new Error(`Unknown chunking strategy: ${strategy}`);
  return chunker(blocks, options);
}

export { semanticTitleChunk, fixedSizeChunk, recursiveChunk };
