// Evaluation tab: shows RAGAS results produced by evaluation/ragas_evaluate.py.
import { api } from './api.js';
import { escapeHtml as esc } from './render.js';

const fmt = (value) => (value === null || value === undefined ? '–' : value.toFixed(2));
const pretty = (text) => text.replace(/_/g, ' ');
const LOW = 0.5; // scores below this are flagged

let container = null;
let data = null;
let state = null;

/** Called each time the tab is opened; reloads the list so new runs appear. */
export async function showEvaluation(element, runId) {
  container = element;
  try {
    const { runs } = await api.listEvaluationRuns();
    if (!runs.length) return renderEmpty();
    const selected = runs.some((run) => run.id === runId) ? runId : runs[0].id;
    data = await api.getEvaluationRun(selected);
    state = { category: 'all', search: '', sort: null, asc: true, open: new Set() };
    data.rows.forEach((row, index) => { row.id = index; });
    renderDashboard(runs, selected);
  } catch (error) {
    container.innerHTML = `<div class="eval-empty"><h2>Could not load results</h2><p>${esc(error.message)}</p></div>`;
  }
}

function renderEmpty() {
  container.innerHTML = `<div class="eval-empty">
    <h2>No evaluation results yet</h2>
    <p>Run the RAGAS evaluation, then open this tab again.</p>
    <code>cd evaluation
python ragas_evaluate.py --sample 15</code>
    <button type="button" class="eval-button" id="eval-refresh">Check again</button>
  </div>`;
}

function renderDashboard(runs, selected) {
  const metrics = data.metrics.map((metric) => metric.name);
  const { run } = data;
  const info = [`${run.questions} questions`, run.judge && `judge: ${run.judge}`, run.embedding && `embeddings: ${run.embedding}`].filter(Boolean).join(' · ');

  const tiles = data.metrics.map((metric) => `
    <div class="tile" data-tip="${esc(metric.name)}: ${fmt(metric.mean)} average over ${metric.scored} scored question${metric.scored === 1 ? '' : 's'}">
      <div class="tile-name">${esc(metric.name)}</div>
      <div class="tile-value">${fmt(metric.mean)}</div>
      <div class="meter"><span style="width:${(metric.mean ?? 0) * 100}%"></span></div>
      <div class="tile-note">${esc(metric.meaning)}${metric.scored < run.questions ? ` (${run.questions - metric.scored} not scored)` : ''}</div>
    </div>`).join('');

  // Category table: one hue, light to dark, value printed in every cell.
  const step = (value) => Math.min(4, Math.floor(value * 5));
  const heatRows = data.categories.map((category) => `<tr><td>${esc(pretty(category.name))}</td><td>${category.count}</td>${metrics.map((metric) => {
    const value = category.means[metric];
    if (value === null) return '<td class="cell"><span class="chip na">–</span></td>';
    const s = step(value);
    return `<td class="cell"><span class="chip" style="background:var(--s${s});color:${s <= 2 ? '#0b0b0b' : '#ffffff'}" data-tip="${esc(pretty(category.name))} · ${esc(metric)}: ${fmt(value)} (${category.count} question${category.count === 1 ? '' : 's'})">${fmt(value)}</span></td>`;
  }).join('')}</tr>`).join('');

  container.innerHTML = `
    <div class="eval-head">
      <div><h2>RAGAS evaluation results</h2><p class="eval-sub">${esc(info)}</p></div>
      <div class="eval-controls">
        <label>Run <select id="eval-run">${runs.map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>
        <button type="button" class="eval-button" id="eval-refresh">Refresh</button>
      </div>
    </div>
    <div class="tiles">${tiles}</div>

    <div class="eval-section">
      <h3>Average score by question category</h3>
      <p>Darker means higher. Out-of-scope questions score low on most metrics by design: the correct reply there is "the documents do not cover this".</p>
      <div class="eval-card">
        <table class="heat"><thead><tr><th>Category</th><th>Questions</th>${metrics.map((metric) => `<th>${esc(metric)}</th>`).join('')}</tr></thead><tbody>${heatRows}</tbody></table>
        <div class="heat-legend">Lower ${[0, 1, 2, 3, 4].map((s) => `<i style="background:var(--s${s})"></i>`).join('')} Higher</div>
      </div>
    </div>

    <div class="eval-section">
      <h3>Every question</h3>
      <p>Click a metric to sort, lowest first. Click a row to compare the app's answer with the reference answer. Scores under ${LOW} are flagged.</p>
      <div class="eval-controls" style="margin-bottom:10px">
        <label>Category <select id="eval-category"><option value="all">All (${data.rows.length})</option>${data.categories.map((category) => `<option value="${esc(category.name)}">${esc(pretty(category.name))} (${category.count})</option>`).join('')}</select></label>
        <input type="search" id="eval-search" placeholder="Search questions" aria-label="Search questions">
        <span id="eval-count"></span>
      </div>
      <div class="eval-card"><table class="questions" id="eval-questions"></table></div>
    </div>`;
  renderQuestions();
}

function scoreCell(value) {
  if (value === null || value === undefined) return '<td class="na">–</td>';
  const low = value < LOW;
  return `<td><span class="score ${low ? 'low' : ''}">${low ? '<span aria-label="low score">&#9888;</span>' : ''}${fmt(value)}<span class="mini"><span style="width:${value * 100}%"></span></span></span></td>`;
}

function renderQuestions() {
  const metrics = data.metrics.map((metric) => metric.name);
  let rows = data.rows.filter((row) => (state.category === 'all' || row.category === state.category)
    && (!state.search || row.question.toLowerCase().includes(state.search)));
  if (state.sort) {
    rows = [...rows].sort((a, b) => {
      const x = a.scores[state.sort] ?? -1;
      const y = b.scores[state.sort] ?? -1;
      return state.asc ? x - y : y - x;
    });
  }
  container.querySelector('#eval-count').textContent = `${rows.length} shown`;
  const head = `<thead><tr><th>Question</th><th>Category</th>${metrics.map((metric) =>
    `<th class="sortable ${state.sort === metric ? `sorted${state.asc ? ' asc' : ''}` : ''}" data-sort="${esc(metric)}">${esc(metric)}</th>`).join('')}</tr></thead>`;
  const body = rows.map((row) => `
    <tr class="row" data-id="${row.id}"><td class="q">${esc(row.question)}</td><td><span class="cat">${esc(pretty(row.category))}</span></td>${metrics.map((metric) => scoreCell(row.scores[metric])).join('')}</tr>${
  state.open.has(row.id) ? `<tr class="detail"><td colspan="${metrics.length + 2}"><div class="detail-grid">
      <div><h4>App's answer</h4><p>${esc(row.answer) || '–'}</p></div>
      <div><h4>Reference answer${row.source ? ` (${esc(row.source)})` : ''}</h4><p>${esc(row.reference) || '–'}</p></div></div></td></tr>` : ''}`).join('');
  container.querySelector('#eval-questions').innerHTML = `${head}<tbody>${body || `<tr><td colspan="${metrics.length + 2}">No questions match.</td></tr>`}</tbody>`;
}

// One set of listeners on the document; they act only inside the evaluation view.
document.addEventListener('click', (event) => {
  if (!container || !container.contains(event.target)) return;
  if (event.target.id === 'eval-refresh') return void showEvaluation(container, data?.run.id);
  const heading = event.target.closest('th.sortable');
  if (heading) {
    state.asc = state.sort === heading.dataset.sort ? !state.asc : true;
    state.sort = heading.dataset.sort;
    return void renderQuestions();
  }
  const row = event.target.closest('tr.row');
  if (row) {
    const id = Number(row.dataset.id);
    if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
    renderQuestions();
  }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'eval-run') showEvaluation(container, event.target.value);
  if (event.target.id === 'eval-category') { state.category = event.target.value; renderQuestions(); }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'eval-search') { state.search = event.target.value.trim().toLowerCase(); renderQuestions(); }
});

// Hover tooltip for tiles and category cells.
document.addEventListener('mousemove', (event) => {
  const tip = document.getElementById('tip');
  const target = event.target.closest?.('[data-tip]');
  if (!tip) return;
  if (!target) { tip.style.display = 'none'; return; }
  tip.textContent = target.dataset.tip;
  tip.style.display = 'block';
  tip.style.left = `${Math.min(event.clientX + 12, innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = `${event.clientY + 14}px`;
});
