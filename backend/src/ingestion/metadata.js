// Metadata extraction: facts about the document that are stored with every chunk
// and shown as the source of an answer.
import crypto from 'node:crypto';
import path from 'node:path';

const prettifyFileName = (fileName) =>
  path
    .basename(fileName, path.extname(fileName))
    .replace(/^\d+[_\-\s]+/, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();

/**
 * @param {string} fileName
 * @param {Buffer} buffer
 * @param {{fileType: string, blocks: Array, info: object}} parsed
 */
export function extractMetadata(fileName, buffer, parsed) {
  const titleBlock = parsed.blocks.find((block) => block.type === 'heading' && block.level === 0);
  const headings = parsed.blocks.filter((block) => block.type === 'heading');
  const text = parsed.blocks.filter((block) => block.type !== 'heading').map((block) => block.text).join(' ');
  return {
    // Same file content -> same id, so re-uploading a file replaces it instead of duplicating it.
    docId: crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32),
    fileName: path.basename(fileName),
    fileType: parsed.fileType,
    title: titleBlock?.text || parsed.info.title || prettifyFileName(fileName),
    author: parsed.info.author,
    pages: parsed.info.pages,
    rows: parsed.info.rows,
    sizeBytes: buffer.length,
    headingCount: headings.length,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    uploadedAt: new Date().toISOString(),
  };
}
