import { api } from './api.js';
import { escapeHtml, renderAnswer, renderSources } from './render.js';
import { showEvaluation } from './evaluation.js';

const $ = (id) => document.getElementById(id);
const messages = $('messages');
const questionInput = $('question');
const sendButton = $('send');

// ---------- Status ----------
async function refreshStatus() {
  const status = $('status');
  try {
    const health = await api.health();
    const problems = [];
    if (!health.qdrant) problems.push('Qdrant is offline');
    if (!health.embeddingModelReady || !health.rerankerReady) problems.push('models are loading');
    if (!health.llmConfigured) problems.push('Gemini API key missing');
    status.className = `status ${problems.length ? 'status-starting' : 'status-ready'}`;
    $('status-text').textContent = problems.length ? problems.join(' · ') : 'Ready';
    $('models').innerHTML = `<span>LLM: ${escapeHtml(health.models.llm)}</span><span>Embeddings: ${escapeHtml(health.models.embedding)}</span><span>Reranker: ${escapeHtml(health.models.reranker)}</span>`;
    return problems.length === 0;
  } catch {
    status.className = 'status status-error';
    $('status-text').textContent = 'Backend is not reachable';
    return false;
  }
}

// ---------- Documents ----------
async function refreshDocuments() {
  const { documents } = await api.listDocuments();
  $('doc-count').textContent = documents.length;
  $('doc-empty').hidden = documents.length > 0;
  $('doc-list').innerHTML = documents
    .map((doc) => `<li class="doc">
        <span class="doc-type">${escapeHtml(doc.fileType)}</span>
        <div style="min-width:0">
          <div class="doc-name" title="${escapeHtml(doc.fileName)}">${escapeHtml(doc.fileName)}</div>
          <div class="doc-meta">${doc.chunkCount} chunks${doc.pages ? ` · ${doc.pages} pages` : ''}${doc.rows ? ` · ${doc.rows} rows` : ''}</div>
        </div>
        <button class="doc-remove" type="button" data-doc="${escapeHtml(doc.docId)}" data-name="${escapeHtml(doc.fileName)}" aria-label="Remove ${escapeHtml(doc.fileName)}">×</button>
      </li>`)
    .join('');
}

$('doc-list').addEventListener('click', async (event) => {
  const button = event.target.closest('.doc-remove');
  if (!button) return;
  if (!window.confirm(`Remove "${button.dataset.name}" and all of its chunks?`)) return;
  button.disabled = true;
  try {
    await api.deleteDocument(button.dataset.doc);
  } catch (error) {
    window.alert(error.message);
  }
  refreshDocuments();
});

// Files are uploaded one at a time so each shows its own progress and result.
async function uploadFiles(files) {
  const log = $('upload-log');
  for (const file of files) {
    const item = document.createElement('li');
    item.innerHTML = `<span class="name">${escapeHtml(file.name)}</span><span class="working">processing…</span>`;
    log.prepend(item);
    const state = item.lastElementChild;
    try {
      const { results } = await api.uploadDocument(file);
      const result = results[0];
      if (result.status === 'ingested') {
        state.className = 'done';
        state.textContent = `${result.document.chunkCount} chunks`;
      } else {
        state.className = 'failed';
        state.textContent = 'failed';
        item.title = result.error;
      }
    } catch (error) {
      state.className = 'failed';
      state.textContent = 'failed';
      item.title = error.message;
    }
    await refreshDocuments().catch(() => {});
  }
}

const dropzone = $('dropzone');
$('file-input').addEventListener('change', (event) => {
  uploadFiles([...event.target.files]);
  event.target.value = '';
});
['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((type) => dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', (event) => uploadFiles([...event.dataTransfer.files]));

// ---------- Chat ----------
function addMessage(className, html) {
  $('welcome')?.remove();
  const element = document.createElement('div');
  element.className = `message ${className}`;
  element.innerHTML = html;
  messages.appendChild(element);
  messages.scrollTop = messages.scrollHeight;
  return element;
}

async function ask(question) {
  addMessage('user', escapeHtml(question));
  const pending = addMessage('assistant', '<div class="thinking"><span class="spinner"></span>Searching your documents…</div>');
  sendButton.disabled = true;
  try {
    const result = await api.ask(question);
    const seconds = (Object.values(result.timings || {}).reduce((a, b) => a + b, 0) / 1000).toFixed(1);
    pending.innerHTML = `<div class="answer">${renderAnswer(result.answer)}</div>${renderSources(result.sources)}<div class="timing">Answered in ${seconds}s</div>`;
  } catch (error) {
    pending.classList.add('error');
    pending.textContent = error.message;
  } finally {
    sendButton.disabled = false;
    messages.scrollTop = messages.scrollHeight;
    questionInput.focus();
  }
}

$('chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question || sendButton.disabled) return;
  questionInput.value = '';
  questionInput.style.height = 'auto';
  ask(question);
});
questionInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    $('chat-form').requestSubmit();
  }
});
questionInput.addEventListener('input', () => {
  questionInput.style.height = 'auto';
  questionInput.style.height = `${questionInput.scrollHeight}px`;
});
$('examples').addEventListener('click', (event) => {
  if (event.target.tagName === 'BUTTON') ask(event.target.textContent);
});

// Clicking a citation opens the sources and highlights the cited passage.
messages.addEventListener('click', (event) => {
  const cite = event.target.closest('.cite');
  if (!cite) return;
  const message = cite.closest('.message');
  const details = message.querySelector('.sources');
  const source = message.querySelector(`.source[data-source="${cite.dataset.cite}"]`);
  if (!details || !source) return;
  details.open = true;
  message.querySelectorAll('.source.highlight').forEach((el) => el.classList.remove('highlight'));
  source.classList.add('highlight');
  source.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

// ---------- Views (Chat / Evaluation) ----------
function showView(name) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === name));
  $('view-chat').hidden = name !== 'chat';
  $('view-evaluation').hidden = name !== 'evaluation';
  if (name === 'evaluation') showEvaluation($('view-evaluation')); // reloads, so new runs appear
  history.replaceState(null, '', name === 'chat' ? location.pathname : '#evaluation');
}
document.querySelector('.tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) showView(tab.dataset.view);
});
if (location.hash === '#evaluation') showView('evaluation');

// ---------- Start ----------
refreshDocuments().catch(() => {});
(async function pollStatus() {
  const ready = await refreshStatus();
  setTimeout(pollStatus, ready ? 30000 : 4000);
})();
