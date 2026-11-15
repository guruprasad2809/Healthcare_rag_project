// Safe rendering helpers: all model/document text is escaped before it touches the DOM.
export const escapeHtml = (text) =>
  String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const inline = (text) =>
  escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(\d{1,2})\]/g, '<button type="button" class="cite" data-cite="$1">$1</button>');

/** Minimal Markdown: paragraphs, bullet/numbered lists, bold, and [n] citations. */
export function renderAnswer(text) {
  const html = [];
  let list = null;
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const tag = bullet ? 'ul' : 'ol';
      if (list !== tag) { closeList(); html.push(`<${tag}>`); list = tag; }
      html.push(`<li>${inline((bullet || numbered)[1])}</li>`);
    } else {
      closeList();
      if (line) html.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`);
    }
  }
  closeList();
  return html.join('');
}

export function renderSources(sources) {
  if (!sources?.length) return '';
  const items = sources
    .map((source) => {
      const path = [source.docTitle, ...(source.headingPath || [])].filter(Boolean).join(' › ');
      const page = source.page ? ` · page ${source.page}` : '';
      const score = typeof source.rerankScore === 'number' ? `relevance ${(source.rerankScore * 100).toFixed(0)}%` : '';
      return `<div class="source" data-source="${source.number}">
        <div class="source-head">
          <span class="source-num">[${source.number}]</span>
          <span class="source-file">${escapeHtml(source.fileName)}${page}</span>
          <span class="source-score">${score}</span>
        </div>
        <div class="source-path">${escapeHtml(path)}</div>
        <div class="source-text">${escapeHtml(source.text)}</div>
      </div>`;
    })
    .join('');
  return `<details class="sources"><summary>Sources (${sources.length})</summary>${items}</details>`;
}
