// PDF parser. PDFs have no heading tags, so headings are recovered from layout:
// lines set in a larger font than the body text are headings, and the bigger the
// font the higher the level. Body-size "LABEL:" / ALL CAPS lines are caught too.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { classifyLine } from '../chunking/headingDetector.js';
import { findRepeatedLines, normaliseFurniture, isPageNumberLine, joinWrappedLines } from '../preprocess.js';

const roundSize = (size) => Math.round(size * 2) / 2;

/** Group the text items of a page into lines (top to bottom). */
function pageLines(items) {
  const lines = [];
  let current = null;
  for (const item of items) {
    if (!item.str) continue;
    const y = item.transform[5];
    const size = item.height || Math.abs(item.transform[3]) || 10;
    if (!current || Math.abs(y - current.y) > Math.max(2, size * 0.5)) {
      if (current) lines.push(current);
      current = { text: '', y, size };
    }
    current.text += item.str;
    if (item.str.trim()) current.size = Math.max(current.size, size);
  }
  if (current) lines.push(current);
  return lines.map((line) => ({ ...line, text: line.text.replace(/\s+/g, ' ').trim(), size: roundSize(line.size) })).filter((l) => l.text);
}

export async function parsePdf(buffer) {
  const loadingTask = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0 });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(pageLines(content.items));
  }
  const metadata = await pdf.getMetadata().catch(() => null);
  await loadingTask.destroy();

  // Drop running headers/footers and page numbers.
  const repeated = findRepeatedLines(pages.map((lines) => lines.map((l) => l.text)));
  const lines = [];
  pages.forEach((pageLinesList, index) => {
    for (const line of pageLinesList) {
      if (isPageNumberLine(line.text) || repeated.has(normaliseFurniture(line.text))) continue;
      lines.push({ ...line, page: index + 1 });
    }
  });

  // Body font size = the size that carries the most characters.
  const charsBySize = new Map();
  for (const line of lines) charsBySize.set(line.size, (charsBySize.get(line.size) || 0) + line.text.length);
  const bodySize = [...charsBySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const headingSizes = [...charsBySize.keys()].filter((size) => size >= bodySize * 1.1).sort((a, b) => b - a);
  const fontLevel = (size) => headingSizes.indexOf(size) + 1; // 1 = largest font
  const labelLevel = headingSizes.length + 1; // text-pattern headings nest below font headings

  const blocks = [];
  let paragraph = null;
  const flush = () => {
    if (paragraph) blocks.push({ type: 'paragraph', text: paragraph.text, page: paragraph.page });
    paragraph = null;
  };

  let previous = null;
  for (const line of lines) {
    const isFontHeading = headingSizes.includes(line.size) && line.text.length <= 250;
    if (isFontHeading) {
      flush();
      const last = blocks[blocks.length - 1];
      // A heading that wraps onto a second line is still one heading.
      if (last?.type === 'heading' && last.size === line.size && previous?.size === line.size && last.page === line.page) {
        last.text = `${last.text} ${line.text}`;
      } else {
        blocks.push({ type: 'heading', text: line.text, level: fontLevel(line.size), size: line.size, page: line.page, style: 'pdf-font' });
      }
      previous = line;
      continue;
    }

    const pattern = classifyLine(line.text, { prevBlank: false, nextBlank: false });
    if (pattern && ['label', 'caps'].includes(pattern.style)) {
      flush();
      blocks.push({ type: 'heading', text: pattern.text, level: labelLevel, page: line.page, style: `pdf-${pattern.style}` });
      previous = line;
      continue;
    }

    // Paragraph break: a clear vertical gap on the same page, or a size change.
    const samePage = previous && previous.page === line.page;
    const gap = samePage ? previous.y - line.y : 0;
    const startsNew = !paragraph || (samePage && gap > line.size * 1.9) || (previous && previous.size !== line.size)
      || (!samePage && /[.!?:]$/.test(paragraph.text));
    if (startsNew) {
      flush();
      paragraph = { text: line.text, page: line.page };
    } else {
      paragraph.text = joinWrappedLines(paragraph.text, line.text);
    }
    previous = line;
  }
  flush();

  // If the document opens with its largest heading, treat that as the title.
  if (blocks[0]?.type === 'heading' && blocks[0].level === 1) blocks[0].level = 0;

  return {
    blocks,
    info: { pages: pageCount, title: metadata?.info?.Title || undefined, author: metadata?.info?.Author || undefined },
  };
}
