// Parser registry: maps a file extension to the parser that understands it.
// To support a new format, write a parser that returns { blocks, info } and add it here.
import path from 'node:path';
import { parsePdf } from './pdfParser.js';
import { parseDocx } from './docxParser.js';
import { parseText } from './textParser.js';
import { parseCsv } from './csvParser.js';

const PARSERS = {
  '.pdf': { type: 'pdf', parse: parsePdf },
  '.docx': { type: 'docx', parse: parseDocx },
  '.txt': { type: 'txt', parse: parseText },
  '.md': { type: 'md', parse: parseText },
  '.csv': { type: 'csv', parse: parseCsv },
};

export const SUPPORTED_EXTENSIONS = Object.keys(PARSERS);

export const isSupported = (fileName) => path.extname(fileName).toLowerCase() in PARSERS;

/**
 * @returns {Promise<{fileType: string, blocks: Array, info: object}>}
 * blocks: [{ type: 'heading', text, level } | { type: 'paragraph', text }]
 */
export async function parseDocument(fileName, buffer) {
  const parser = PARSERS[path.extname(fileName).toLowerCase()];
  if (!parser) {
    const error = new Error(`Unsupported file type: ${fileName}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
    error.status = 415;
    throw error;
  }
  const { blocks, info } = await parser.parse(buffer);
  return { fileType: parser.type, blocks, info: info || {} };
}
