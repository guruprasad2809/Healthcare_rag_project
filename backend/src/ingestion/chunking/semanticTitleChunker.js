// Semantic Title-Based Chunking (the primary chunking strategy).
//
// 1. TITLE step    - headings split the document into sections. Every section keeps
//                    its full heading path ("Asthma > What causes Asthma?").
// 2. MERGE step    - very small neighbouring sections under the same parent are
//                    merged, and a tiny lead-in is attached to the section it introduces.
// 3. SEMANTIC step - a section that is too long is split between sentences at the
//                    points where the topic shifts most (lowest embedding similarity
//                    between neighbouring sentences), never in the middle of a sentence.
// 4. CONTEXT step  - the document title and heading path are prepended to the text
//                    that is embedded and indexed, so every chunk says what it is about.
import { estimateTokens, splitSentences, cosineSimilarity } from '../../utils/text.js';

const DEFAULTS = { maxTokens: 450, minTokens: 40, mergeTargetTokens: 200, semanticSplit: true, breakpointPercentile: 0.3 };

/** Step 1: turn the flat block list into sections with heading paths. */
export function buildSections(blocks) {
  const sections = [];
  const stack = []; // open headings: [{ level, title }]
  let current = null;

  const open = (page) => {
    current = { path: stack.map((h) => h.title), level: stack.length ? stack[stack.length - 1].level : 0, parts: [], page };
    sections.push(current);
  };

  for (const block of blocks) {
    if (block.type === 'heading') {
      if (block.level === 0) { // document title: not part of the path
        stack.length = 0;
        current = null;
        continue;
      }
      while (stack.length && stack[stack.length - 1].level >= block.level) stack.pop();
      stack.push({ level: block.level, title: block.text });
      open(block.page);
    } else {
      if (!current) open(block.page);
      current.parts.push(block.text);
      if (current.page === undefined) current.page = block.page;
    }
  }
  return sections
    .map((section) => ({ ...section, text: section.parts.join('\n\n').trim(), titles: [section.path[section.path.length - 1]].filter(Boolean) }))
    .filter((section) => section.text);
}

const isDescendant = (child, parent) =>
  child.path.length > parent.path.length && parent.path.every((title, i) => child.path[i] === title);
const withTitle = (section) => {
  const title = section.path[section.path.length - 1];
  if (!title) return section.text;
  const wanted = title.toLowerCase();
  const alreadyThere = section.text.split('\n').some((line) => {
    const lower = line.toLowerCase();
    return lower.startsWith(wanted) || lower.endsWith(`: ${wanted}`);
  });
  return alreadyThere ? section.text : `${title}\n${section.text}`;
};

/** Step 2: merge tiny sections so no chunk is too small to be useful. */
export function mergeSmallSections(sections, { minTokens, mergeTargetTokens, maxTokens }) {
  // 2a. A tiny lead-in (text right under a heading that has sub-headings) joins its first sub-section.
  const attached = [];
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    const next = sections[i + 1];
    if (next && section.path.length > 0 && estimateTokens(section.text) < minTokens && isDescendant(next, section)) {
      sections[i + 1] = { ...next, text: `${section.text}\n\n${next.text}`, page: section.page ?? next.page };
    } else {
      attached.push(section);
    }
  }

  // 2b. Runs of tiny sibling sections are packed together up to the merge target.
  const merged = [];
  let buffer = null;
  const siblingKey = (section, pathLength) => `${pathLength}|${section.path.slice(0, pathLength - 1).join(' > ')}`;
  const flush = () => {
    if (!buffer) return;
    const group = buffer.count === 1 ? buffer.first : {
      path: buffer.first.path.slice(0, -1),
      level: buffer.first.level,
      page: buffer.first.page,
      text: buffer.texts.join('\n\n'),
      titles: buffer.titles,
    };
    // A group that is still tiny joins the sibling section just before it.
    const last = merged[merged.length - 1];
    if (buffer.tokens < minTokens && last?.siblingKey === buffer.key
      && estimateTokens(last.text) + buffer.tokens <= maxTokens) {
      merged[merged.length - 1] = {
        ...last,
        path: buffer.first.path.slice(0, -1),
        text: `${last.titles.length === 1 && last.path.length === buffer.pathLength ? withTitle(last) : last.text}\n\n${buffer.texts.join('\n\n')}`,
        titles: [...last.titles, ...buffer.titles],
      };
    } else {
      merged.push({ ...group, siblingKey: buffer.key });
    }
    buffer = null;
  };

  for (const section of attached) {
    const key = siblingKey(section, section.path.length);
    const small = estimateTokens(section.text) < minTokens && section.path.length > 0;
    if (!small) { flush(); merged.push({ ...section, siblingKey: key }); continue; }
    if (buffer && (buffer.key !== key || buffer.tokens >= mergeTargetTokens)) flush();
    if (!buffer) buffer = { key, pathLength: section.path.length, first: section, texts: [], titles: [], tokens: 0, count: 0 };
    buffer.texts.push(withTitle(section));
    buffer.titles.push(section.path[section.path.length - 1]);
    buffer.tokens += estimateTokens(section.text);
    buffer.count += 1;
  }
  flush();
  return merged;
}

/** Break a section into sentence units, remembering where paragraphs start. */
function sentenceUnits(text) {
  const units = [];
  for (const paragraph of text.split(/\n+/)) {
    splitSentences(paragraph).forEach((sentence, index) => units.push({ text: sentence, newParagraph: index === 0 }));
  }
  return units;
}

/** A single sentence longer than the limit is split on word boundaries as a last resort. */
function hardSplit(unit, maxTokens) {
  if (estimateTokens(unit.text) <= maxTokens) return [unit];
  const words = unit.text.split(/\s+/);
  const pieces = [];
  let piece = [];
  for (const word of words) {
    if (estimateTokens([...piece, word].join(' ')) > maxTokens && piece.length) {
      pieces.push({ text: piece.join(' '), newParagraph: pieces.length === 0 && unit.newParagraph });
      piece = [];
    }
    piece.push(word);
  }
  if (piece.length) pieces.push({ text: piece.join(' '), newParagraph: pieces.length === 0 && unit.newParagraph });
  return pieces;
}

const joinUnits = (units) => units.map((u, i) => (i === 0 ? u.text : `${u.newParagraph ? '\n' : ' '}${u.text}`)).join('');

/** Step 3: split one oversized section at semantic breakpoints. */
export async function splitLongSection(text, options, embedder) {
  const { maxTokens, minTokens, semanticSplit, breakpointPercentile } = options;
  const units = sentenceUnits(text).flatMap((unit) => hardSplit(unit, maxTokens));
  if (units.length <= 1) return [text];

  // Similarity between each sentence and the next one; low similarity = topic shift.
  let isBreakpoint = units.map(() => false);
  if (semanticSplit && embedder) {
    const vectors = await embedder.embedDocuments(units.map((u) => u.text));
    const similarities = units.slice(1).map((_, i) => cosineSimilarity(vectors[i], vectors[i + 1]));
    const sorted = [...similarities].sort((a, b) => a - b);
    const threshold = sorted[Math.floor(sorted.length * breakpointPercentile)] ?? -1;
    isBreakpoint = units.map((_, i) => i > 0 && similarities[i - 1] <= threshold);
  } else {
    isBreakpoint = units.map((u, i) => i > 0 && u.newParagraph); // fall back to paragraph boundaries
  }

  const pieces = [];
  let current = [];
  let chars = 0; // running length of the joined piece (units + separators)
  const maxChars = maxTokens * 4;
  units.forEach((unit, i) => {
    const mustCut = chars + unit.text.length + 1 > maxChars;
    const goodCut = isBreakpoint[i] && chars >= maxChars * 0.5;
    if (current.length && (mustCut || goodCut)) {
      pieces.push(current);
      current = [];
      chars = 0;
    }
    current.push(unit);
    chars += unit.text.length + 1;
  });
  if (current.length) pieces.push(current);

  // Do not leave a tiny tail behind.
  if (pieces.length > 1) {
    const tail = pieces[pieces.length - 1];
    const previous = pieces[pieces.length - 2];
    if (estimateTokens(joinUnits(tail)) < minTokens && estimateTokens(joinUnits([...previous, ...tail])) <= maxTokens * 1.15) {
      pieces.splice(pieces.length - 2, 2, [...previous, ...tail]);
    }
  }
  return pieces.map(joinUnits);
}

const sectionTitle = (section) => {
  const titles = section.titles?.length ? section.titles : [];
  if (titles.length <= 1) return titles[0] || '';
  return titles.length <= 3 ? titles.join(', ') : `${titles.slice(0, 3).join(', ')} (+${titles.length - 3} more)`;
};

/**
 * @param {Array} blocks  [{type:'heading', level, text} | {type:'paragraph', text}]
 * @param {{docTitle: string, embedder?: {embedDocuments: Function}} & Partial<typeof DEFAULTS>} options
 * @returns {Promise<Array<{text, embeddingText, headingPath, sectionTitle, page, part, partsTotal, tokenEstimate}>>}
 */
export async function semanticTitleChunk(blocks, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const sections = mergeSmallSections(buildSections(blocks), settings);
  const chunks = [];

  for (const section of sections) {
    const pieces = estimateTokens(section.text) > settings.maxTokens
      ? await splitLongSection(section.text, settings, settings.embedder)
      : [section.text];
    const title = sectionTitle(section);
    const headingPath = section.titles?.length > 1 ? [...section.path, title] : section.path;

    pieces.forEach((text, index) => {
      const breadcrumb = [settings.docTitle, ...headingPath].filter(Boolean).join(' > ');
      chunks.push({
        text,
        // Title context is embedded and keyword-indexed together with the body.
        embeddingText: breadcrumb ? `${breadcrumb}\n${text}` : text,
        headingPath,
        sectionTitle: title || settings.docTitle || '',
        page: section.page,
        part: index + 1,
        partsTotal: pieces.length,
        tokenEstimate: estimateTokens(text),
      });
    });
  }
  return chunks;
}
