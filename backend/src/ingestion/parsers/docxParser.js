// DOCX parser. mammoth converts Word styles (Title, Heading 1-6) to HTML tags,
// so real document headings are kept instead of being guessed.
import mammoth from 'mammoth';

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (html) =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

export async function parseDocx(buffer) {
  const { value: html } = await mammoth.convertToHtml(
    { buffer },
    { styleMap: ["p[style-name='Title'] => h1.doc-title:fresh", "p[style-name='Subtitle'] => p.subtitle:fresh"] },
  );

  const blocks = [];
  const pattern = /<(h[1-6]|p|li|tr)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = match[2] || '';
    if (tag === 'tr') {
      const cells = [...match[3].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => decode(c[1]).trim());
      const text = cells.filter(Boolean).join(' | ');
      if (text) blocks.push({ type: 'paragraph', text });
      continue;
    }
    const text = decode(match[3]).trim();
    if (!text) continue;
    if (tag.startsWith('h')) {
      const level = /doc-title/.test(attrs) ? 0 : Number(tag[1]);
      blocks.push({ type: 'heading', text, level, style: 'docx-style' });
    } else {
      blocks.push({ type: 'paragraph', text: tag === 'li' ? `- ${text}` : text });
    }
  }
  return { blocks: mergeListItems(blocks), info: {} };
}

/** Keep consecutive list items together as one paragraph. */
function mergeListItems(blocks) {
  const merged = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (block.type === 'paragraph' && block.text.startsWith('- ') && last?.type === 'paragraph' && last.text.startsWith('- ')) {
      last.text += `\n${block.text}`;
    } else {
      merged.push({ ...block });
    }
  }
  return merged;
}
