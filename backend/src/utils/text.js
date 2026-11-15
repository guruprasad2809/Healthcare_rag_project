// Shared text helpers used by ingestion, chunking and retrieval.

/** Rough token estimate (about 4 characters per token for English text). */
export const estimateTokens = (text) => Math.ceil((text || '').length / 4);

/** Collapse runs of spaces/tabs but keep line breaks. */
export const collapseSpaces = (text) => text.replace(/[ \t ]+/g, ' ').trim();

/**
 * Split text into sentences. Avoids breaking on common medical/English
 * abbreviations ("Dr.", "e.g.", "mg.") and on decimals ("2.5 mg").
 */
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'vs', 'etc', 'e.g', 'i.e', 'fig', 'no', 'approx', 'st', 'jr', 'sr', 'inc', 'ltd', 'al',
]);

export function splitSentences(text) {
  const sentences = [];
  let start = 0;
  const pattern = /[.!?]+["')\]]*\s+/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const before = text.slice(start, match.index);
    const lastWord = before.split(/\s+/).pop().toLowerCase().replace(/[^a-z.]/g, '');
    const next = text[end] || '';
    if (ABBREVIATIONS.has(lastWord) || /^[a-z]$/.test(lastWord)) continue; // abbreviation or initial
    if (next && !/[A-Z0-9"'(\[-]/.test(next)) continue; // next sentence should start like one
    sentences.push(text.slice(start, end).trim());
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences.filter(Boolean);
}

export const cosineSimilarity = (a, b) => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
};
