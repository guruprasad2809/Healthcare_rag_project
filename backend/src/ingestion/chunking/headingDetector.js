// Heading detection for text that carries no explicit structure (TXT files,
// body-size lines in PDFs). Returns a "style" for lines that look like titles;
// assignHeuristicLevels() then turns styles into heading levels.

const TERMINAL_PUNCTUATION = /[.;,]$/;
const wordCount = (line) => line.split(/\s+/).filter(Boolean).length;

/**
 * @param {string} line   trimmed line
 * @param {{prevBlank?: boolean, nextBlank?: boolean}} ctx  neighbours of the line
 * @returns {{style: string, level?: number, text: string} | null}
 */
export function classifyLine(line, ctx = {}) {
  if (!line || line.length < 2 || line.length > 200) return null;

  // Markdown heading: "## Title"
  const markdown = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
  if (markdown) return { style: 'markdown', level: markdown[1].length, text: markdown[2] };

  // Numbered heading: "2. Methods", "3.1 Dosage" (not a numbered sentence)
  const numbered = line.match(/^(\d{1,3}(?:\.\d{1,3}){0,3})[.)]?\s+([A-Z].*)$/);
  if (numbered && !TERMINAL_PUNCTUATION.test(line) && !/:$/.test(line) && wordCount(line) <= 30 && ctx.prevBlank !== false) {
    const depth = numbered[1].split('.').length;
    return { style: `numbered-${depth}`, text: line };
  }

  // Label heading: "ASSESSMENT:", "Medications:"
  if (/^[A-Z][A-Za-z0-9 /&()'\-]{1,60}:$/.test(line) && wordCount(line) <= 8) {
    return { style: 'label', text: line.slice(0, -1) };
  }

  // ALL CAPS heading: "PATIENT HISTORY", "REPORT 1: VIDEO EEG"
  const letters = line.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase() && wordCount(line) <= 15 && line.length <= 120 && !/\.$/.test(line)) {
    return { style: 'caps', text: line };
  }

  const standalone = ctx.prevBlank === true && ctx.nextBlank === true;

  // Question heading: "What causes asthma?" on its own line
  if (standalone && /\?$/.test(line) && /^[A-Z]/.test(line) && wordCount(line) <= 30) {
    return { style: 'question', text: line };
  }

  // Title Case heading: short standalone line, no end punctuation, mostly capitalised words
  if (standalone && line.length <= 80 && wordCount(line) <= 10 && !/[.!?,;:]$/.test(line) && /^[A-Z]/.test(line) && !/[:(/]/.test(line)) {
    const words = line.split(/\s+/).filter((w) => w.replace(/[^A-Za-z]/g, '').length > 3);
    const capitalised = words.filter((w) => /^[A-Z]/.test(w)).length;
    if (words.length > 0 && capitalised / words.length >= 0.6) return { style: 'titlecase', text: line };
  }
  return null;
}

/**
 * Give heading levels to blocks whose level is still unknown.
 * - A heading on the very first line is the document title (level 0).
 * - Each heuristic style gets a level in the order the styles first appear:
 *   the style seen first is the outermost. In a clinical note "REPORT 1: ..."
 *   (caps) appears before "IMPRESSION:" (label), so labels nest inside reports.
 * @param {Array} blocks   blocks with {type, text, style?, level?}
 * @param {number} baseLevel  first level to hand out to heuristic styles
 */
export function assignHeuristicLevels(blocks, baseLevel = 1) {
  const levelOfStyle = new Map();
  let firstHeadingSeen = false;
  return blocks.map((block, index) => {
    if (block.type !== 'heading') return block;
    if (!firstHeadingSeen && index === 0) {
      firstHeadingSeen = true;
      return { ...block, level: 0 };
    }
    firstHeadingSeen = true;
    if (Number.isInteger(block.level)) return block;
    if (!levelOfStyle.has(block.style)) levelOfStyle.set(block.style, baseLevel + levelOfStyle.size);
    return { ...block, level: levelOfStyle.get(block.style) };
  });
}
