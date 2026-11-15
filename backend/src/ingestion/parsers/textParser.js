// TXT / Markdown parser. Turns lines into heading and paragraph blocks.
import { classifyLine, assignHeuristicLevels } from '../chunking/headingDetector.js';

const isBlank = (line) => !line || !line.trim();
const isBullet = (line) => /^\s*([-*•]|\d{1,3}[.)])\s+/.test(line);
const SETEXT_H1 = /^={3,}\s*$/;
const SETEXT_H2 = /^-{3,}\s*$/;

export function parseText(buffer) {
  const lines = buffer.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];

  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join('') });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (isBlank(line)) { flush(); continue; }
    if (SETEXT_H1.test(line) || SETEXT_H2.test(line)) continue; // underline already consumed

    // Setext heading: a line underlined with === or ---
    const next = (lines[i + 1] || '').trim();
    if (!paragraph.length && line.length <= 200 && (SETEXT_H1.test(next) || SETEXT_H2.test(next))) {
      flush();
      blocks.push({ type: 'heading', text: line, style: 'setext', level: SETEXT_H1.test(next) ? 1 : 2 });
      continue;
    }

    const heading = paragraph.length
      ? null
      : classifyLine(line, { prevBlank: i === 0 || isBlank(lines[i - 1]), nextBlank: isBlank(lines[i + 1]) });
    // Label/caps/markdown lines are headings even when text follows directly.
    const midParagraph = paragraph.length ? classifyLine(line, { prevBlank: false, nextBlank: false }) : null;
    const found = heading || (midParagraph && ['label', 'caps', 'markdown'].includes(midParagraph.style) ? midParagraph : null);
    if (found) {
      flush();
      blocks.push({ type: 'heading', text: found.text, style: found.style, level: found.level });
      continue;
    }
    paragraph.push(paragraph.length ? (isBullet(line) ? `\n${line}` : ` ${line}`) : line);
  }
  flush();
  return { blocks: assignHeuristicLevels(blocks), info: {} };
}
