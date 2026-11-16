"""
Build an HTML dashboard from RAGAS results.

Reads a ragas_scores_*.csv file written by ragas_evaluate.py and writes one
self-contained HTML page (no internet needed) that shows:
  - the five RAGAS metrics as headline numbers,
  - average scores for each question category,
  - every question with its scores, the app's answer and the reference answer.

Usage:
    python build_dashboard.py                       # newest results file
    python build_dashboard.py results/ragas_scores_20261116_171500.csv
    python build_dashboard.py --no-open             # do not open the browser
"""
import argparse
import html
import json
import sys
import webbrowser
from pathlib import Path

import pandas as pd

RESULTS = Path(__file__).resolve().parent / "results"
METRICS = ["Faithfulness", "Answer Relevancy", "Context Precision", "Context Recall", "Answer Correctness"]
MEANING = {
    "Faithfulness": "Is the answer supported by the retrieved passages?",
    "Answer Relevancy": "Does the answer address the question?",
    "Context Precision": "Are the retrieved passages relevant and well ranked?",
    "Context Recall": "Did retrieval find everything the answer needs?",
    "Answer Correctness": "Does the answer match the reference answer?",
}


def parse_args():
    parser = argparse.ArgumentParser(description="Build an HTML dashboard from RAGAS scores")
    parser.add_argument("scores", nargs="?", help="ragas_scores_*.csv (default: newest in results/)")
    parser.add_argument("--output", help="output HTML path (default: next to the scores file)")
    parser.add_argument("--no-open", action="store_true", help="do not open the dashboard in the browser")
    return parser.parse_args()


def clean(value):
    """NaN -> None and numpy numbers -> rounded floats, so the data is valid JSON."""
    return None if pd.isna(value) else round(float(value), 3)


def main():
    args = parse_args()
    if args.scores:
        scores_file = Path(args.scores)
    else:
        files = sorted(RESULTS.glob("ragas_scores_*.csv"))
        if not files:
            sys.exit(f"No ragas_scores_*.csv found in {RESULTS}. Run ragas_evaluate.py first.")
        scores_file = files[-1]
    if not scores_file.exists():
        sys.exit(f"File not found: {scores_file}")

    scores = pd.read_csv(scores_file)
    metrics = [name for name in METRICS if name in scores.columns]
    if not metrics:
        sys.exit(f"{scores_file} has none of the expected metric columns: {METRICS}")
    if "question_category" not in scores.columns:
        scores["question_category"] = "all"
    scores["question_category"] = scores["question_category"].fillna("uncategorised")

    stamp = scores_file.stem.replace("ragas_scores_", "")
    summary_file = scores_file.with_name(f"ragas_summary_{stamp}.json")
    run = json.loads(summary_file.read_text(encoding="utf-8")) if summary_file.exists() else {}

    data = {
        "run": {
            "file": scores_file.name,
            "questions": len(scores),
            "judge": run.get("judge_model", ""),
            "embedding": run.get("embedding_model", ""),
        },
        "metrics": [
            {"name": name, "meaning": MEANING[name], "mean": clean(scores[name].mean()), "scored": int(scores[name].notna().sum())}
            for name in metrics
        ],
        "categories": [
            {"name": category, "count": len(group), "means": {name: clean(group[name].mean()) for name in metrics}}
            for category, group in scores.groupby("question_category", sort=True)
        ],
        "rows": [
            {
                "question": str(row.get("user_input", "")),
                "category": row["question_category"],
                "source": "" if pd.isna(row.get("source_file")) else str(row.get("source_file")),
                "answer": "" if pd.isna(row.get("response")) else str(row.get("response")),
                "reference": "" if pd.isna(row.get("reference")) else str(row.get("reference")),
                "scores": {name: clean(row[name]) for name in metrics},
            }
            for _, row in scores.iterrows()
        ],
    }

    # "</" is escaped so answer text can never close the <script> tag.
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    page = TEMPLATE.replace("__TITLE__", html.escape(f"RAGAS results - {stamp}")).replace("__DATA__", payload)
    output = Path(args.output) if args.output else scores_file.with_name(f"ragas_dashboard_{stamp}.html")
    output.write_text(page, encoding="utf-8")
    print(f"Dashboard written to {output}")
    if not args.no_open:
        webbrowser.open(output.resolve().as_uri())


TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>__TITLE__</title>
<style>
  :root {
    --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781; --line: #e1e0d9;
    --track: #ecebe6; --bar: #2a78d6; --critical: #d03b3b;
    --s0: #cde2fb; --s1: #9ec5f4; --s2: #6da7ec; --s3: #3987e5; --s4: #1c5cab;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --line: #2c2c2a;
      --track: #2c2c2a; --bar: #3987e5; --critical: #e66767;
      --s0: #0d366b; --s1: #184f95; --s2: #256abf; --s3: #5598e7; --s4: #9ec5f4;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 1180px; margin: 0 auto; padding: 28px 20px 60px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  .sub { color: var(--ink-2); font-size: 13px; margin: 0 0 14px; }
  section { margin-top: 30px; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-top: 18px; }
  .tile { padding: 14px 16px; }
  .tile-name { font-size: 13px; color: var(--ink-2); }
  .tile-value { font-size: 34px; font-weight: 650; line-height: 1.15; font-variant-numeric: tabular-nums; }
  .tile-note { font-size: 12px; color: var(--muted); min-height: 36px; }
  .meter { height: 6px; background: var(--track); border-radius: 3px; margin: 8px 0; overflow: hidden; }
  .meter span { display: block; height: 100%; background: var(--bar); border-radius: 0 3px 3px 0; }

  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
  th, td { padding: 9px 12px; text-align: right; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { font-size: 12px; font-weight: 600; color: var(--ink-2); }
  th:first-child, td:first-child { text-align: left; }
  tbody tr:last-child td { border-bottom: 0; }
  .heat td.cell { padding: 2px; border-bottom: 0; }
  .heat .chip { display: block; padding: 8px 10px; border-radius: 4px; text-align: center; font-weight: 600; }
  .heat td, .heat th { border-bottom: 0; }
  .legend { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); padding: 10px 12px; }
  .legend i { width: 26px; height: 10px; border-radius: 2px; display: inline-block; }

  .controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 10px; font-size: 13px; color: var(--ink-2); }
  select, input[type=search] { font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; }
  input[type=search] { min-width: 220px; }
  .questions th.sortable { cursor: pointer; user-select: none; }
  .questions th.sorted::after { content: " \2193"; }
  .questions th.sorted.asc::after { content: " \2191"; }
  .questions td.q { white-space: normal; min-width: 260px; max-width: 420px; }
  .questions tbody tr.row { cursor: pointer; }
  .questions tbody tr.row:hover td { background: var(--track); }
  .cat { font-size: 11px; color: var(--ink-2); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; }
  .score { display: inline-flex; align-items: center; gap: 6px; justify-content: flex-end; }
  .mini { width: 44px; height: 5px; background: var(--track); border-radius: 3px; overflow: hidden; }
  .mini span { display: block; height: 100%; background: var(--bar); }
  .low { color: var(--critical); font-weight: 650; }
  .na { color: var(--muted); }
  tr.detail td { white-space: normal; text-align: left; background: var(--page); }
  .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .detail h3 { font-size: 12px; margin: 0 0 4px; color: var(--ink-2); }
  .detail p { margin: 0; white-space: pre-wrap; }
  @media (max-width: 760px) { .detail-grid { grid-template-columns: 1fr; } }
  #tip { position: fixed; pointer-events: none; background: var(--ink); color: var(--surface); font-size: 12px; padding: 6px 8px; border-radius: 6px; max-width: 280px; display: none; z-index: 5; }
</style>
</head>
<body>
<main>
  <h1>RAGAS evaluation results</h1>
  <p class="sub" id="run"></p>
  <div class="tiles" id="tiles"></div>

  <section>
    <h2>Average score by question category</h2>
    <p class="sub">Each cell is the average for that category. Darker means higher. Out-of-scope questions score low on most metrics by design: the correct reply there is "the documents do not cover this".</p>
    <div class="card table-wrap"><table class="heat" id="heat"></table>
      <div class="legend">Lower <i style="background:var(--s0)"></i><i style="background:var(--s1)"></i><i style="background:var(--s2)"></i><i style="background:var(--s3)"></i><i style="background:var(--s4)"></i> Higher</div>
    </div>
  </section>

  <section>
    <h2>Every question</h2>
    <p class="sub">Click a column to sort. Click a row to see the app's answer next to the reference answer. Scores under 0.5 are marked in red with a warning sign.</p>
    <div class="controls">
      <label>Category <select id="category"></select></label>
      <input type="search" id="search" placeholder="Search questions" aria-label="Search questions">
      <span id="count"></span>
    </div>
    <div class="card table-wrap"><table class="questions" id="questions"></table></div>
  </section>
</main>
<div id="tip"></div>
<script id="data" type="application/json">__DATA__</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const METRICS = DATA.metrics.map(m => m.name);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = v => v === null || v === undefined ? '–' : v.toFixed(2);
const pretty = s => s.replace(/_/g, ' ');

// ---- run info and headline tiles ----
const run = DATA.run;
document.getElementById('run').textContent =
  `${run.questions} questions` + (run.judge ? ` · judge: ${run.judge}` : '') + (run.embedding ? ` · embeddings: ${run.embedding}` : '') + ` · ${run.file}`;
document.getElementById('tiles').innerHTML = DATA.metrics.map(m => `
  <div class="card tile" data-tip="${esc(m.name)}: ${fmt(m.mean)} average over ${m.scored} scored question${m.scored === 1 ? '' : 's'}">
    <div class="tile-name">${esc(m.name)}</div>
    <div class="tile-value">${fmt(m.mean)}</div>
    <div class="meter"><span style="width:${(m.mean ?? 0) * 100}%"></span></div>
    <div class="tile-note">${esc(m.meaning)}${m.scored < run.questions ? ` (${run.questions - m.scored} not scored)` : ''}</div>
  </div>`).join('');

// ---- category heat table (one hue, light to dark) ----
const step = v => Math.min(4, Math.floor(v * 5));
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const inkOn = s => (dark ? s >= 3 : s <= 2) ? '#0b0b0b' : '#ffffff';
document.getElementById('heat').innerHTML =
  `<thead><tr><th>Category</th><th>Questions</th>${METRICS.map(m => `<th>${esc(m)}</th>`).join('')}</tr></thead><tbody>` +
  DATA.categories.map(c => `<tr><td>${esc(pretty(c.name))}</td><td>${c.count}</td>` + METRICS.map(m => {
    const v = c.means[m];
    if (v === null) return `<td class="cell"><span class="chip na">–</span></td>`;
    const s = step(v);
    return `<td class="cell"><span class="chip" style="background:var(--s${s});color:${inkOn(s)}" data-tip="${esc(pretty(c.name))} · ${esc(m)}: ${fmt(v)} (${c.count} question${c.count === 1 ? '' : 's'})">${fmt(v)}</span></td>`;
  }).join('') + '</tr>').join('') + '</tbody>';

// ---- per-question table: filter, search, sort, expand ----
const state = { category: 'all', search: '', sort: null, asc: true, open: new Set() };
const categorySelect = document.getElementById('category');
categorySelect.innerHTML = `<option value="all">All (${DATA.rows.length})</option>` +
  DATA.categories.map(c => `<option value="${esc(c.name)}">${esc(pretty(c.name))} (${c.count})</option>`).join('');
DATA.rows.forEach((row, i) => { row.id = i; });

function scoreCell(v) {
  if (v === null || v === undefined) return '<td class="na">–</td>';
  const low = v < 0.5;
  return `<td><span class="score ${low ? 'low' : ''}">${low ? '<span aria-label="low score">&#9888;</span>' : ''}${fmt(v)}<span class="mini"><span style="width:${v * 100}%"></span></span></span></td>`;
}

function render() {
  let rows = DATA.rows.filter(r => (state.category === 'all' || r.category === state.category)
    && (!state.search || r.question.toLowerCase().includes(state.search)));
  if (state.sort) {
    rows = [...rows].sort((a, b) => {
      const x = a.scores[state.sort] ?? -1, y = b.scores[state.sort] ?? -1;
      return state.asc ? x - y : y - x;
    });
  }
  document.getElementById('count').textContent = `${rows.length} shown`;
  const head = `<thead><tr><th>Question</th><th>Category</th>${METRICS.map(m =>
    `<th class="sortable ${state.sort === m ? 'sorted' + (state.asc ? ' asc' : '') : ''}" data-sort="${esc(m)}">${esc(m)}</th>`).join('')}</tr></thead>`;
  const body = rows.map(r => `
    <tr class="row" data-id="${r.id}"><td class="q">${esc(r.question)}</td><td><span class="cat">${esc(pretty(r.category))}</span></td>${METRICS.map(m => scoreCell(r.scores[m])).join('')}</tr>` +
    (state.open.has(r.id) ? `<tr class="detail"><td colspan="${METRICS.length + 2}"><div class="detail-grid">
      <div><h3>App's answer</h3><p>${esc(r.answer) || '–'}</p></div>
      <div><h3>Reference answer${r.source ? ` (${esc(r.source)})` : ''}</h3><p>${esc(r.reference) || '–'}</p></div></div></td></tr>` : '')).join('');
  document.getElementById('questions').innerHTML = head + `<tbody>${body || `<tr><td colspan="${METRICS.length + 2}">No questions match.</td></tr>`}</tbody>`;
}

categorySelect.addEventListener('change', e => { state.category = e.target.value; render(); });
document.getElementById('search').addEventListener('input', e => { state.search = e.target.value.trim().toLowerCase(); render(); });
document.getElementById('questions').addEventListener('click', e => {
  const th = e.target.closest('th.sortable');
  if (th) {
    const metric = th.dataset.sort;
    state.asc = state.sort === metric ? !state.asc : true; // first click: lowest scores first
    state.sort = metric;
    return render();
  }
  const tr = e.target.closest('tr.row');
  if (tr) {
    const id = Number(tr.dataset.id);
    state.open.has(id) ? state.open.delete(id) : state.open.add(id);
    render();
  }
});
render();

// ---- hover tooltip ----
const tip = document.getElementById('tip');
document.addEventListener('mousemove', e => {
  const target = e.target.closest('[data-tip]');
  if (!target) { tip.style.display = 'none'; return; }
  tip.textContent = target.dataset.tip;
  tip.style.display = 'block';
  tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px';
  tip.style.top = (e.clientY + 14) + 'px';
});
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
