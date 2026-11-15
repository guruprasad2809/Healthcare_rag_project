// Text preprocessing: clean up what the parsers extracted before it is chunked.

const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl' };

/** Normalise one piece of text (a heading or a paragraph). */
export function cleanText(text) {
  if (!text) return '';
  return text
    .normalize('NFKC')
    .replace(/[ﬀ-ﬄ]/g, (ch) => LIGATURES[ch] || ch)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f﻿​]/g, '') // control chars, BOM, zero-width
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lines that are only page furniture: "Page 3 of 10", "- 4 -", a lone number. */
export const isPageNumberLine = (line) =>
  /^(page\s+)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(line.trim()) || /^[-–—]\s*\d{1,4}\s*[-–—]$/.test(line.trim());

/**
 * Find running headers/footers: short lines that repeat on most pages.
 * @param {string[][]} pages  lines of each page
 * @returns {Set<string>} normalised lines to drop
 */
export function findRepeatedLines(pages) {
  const repeated = new Set();
  if (pages.length < 3) return repeated;
  const counts = new Map();
  for (const lines of pages) {
    const edge = new Set([...lines.slice(0, 2), ...lines.slice(-2)].map(normaliseFurniture));
    for (const line of edge) if (line) counts.set(line, (counts.get(line) || 0) + 1);
  }
  for (const [line, count] of counts) if (count >= Math.ceil(pages.length * 0.6)) repeated.add(line);
  return repeated;
}

export const normaliseFurniture = (line) => line.trim().toLowerCase().replace(/\d+/g, '#');

/** Join two wrapped lines, repairing words hyphenated across the line break. */
export function joinWrappedLines(previous, next) {
  if (!previous) return next;
  if (/[a-z]-$/.test(previous) && /^[a-z]/.test(next)) return previous.slice(0, -1) + next;
  return `${previous} ${next}`;
}

/** Clean every block and drop the ones that end up empty. */
export function preprocessBlocks(blocks) {
  const cleaned = [];
  for (const block of blocks) {
    const text = cleanText(block.text);
    if (!text) continue;
    if (block.type === 'heading') cleaned.push({ ...block, text: text.replace(/\n+/g, ' ').replace(/[:\s]+$/, '') });
    else cleaned.push({ ...block, text });
  }
  return cleaned;
}
