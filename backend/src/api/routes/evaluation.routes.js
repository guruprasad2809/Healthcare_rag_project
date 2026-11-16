// Serves RAGAS results (written by evaluation/ragas_evaluate.py) to the dashboard tab.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { parse } from 'csv-parse/sync';
import { asyncHandler, httpError } from '../middleware/errorHandler.js';

const METRICS = [
  { name: 'Faithfulness', meaning: 'Is the answer supported by the retrieved passages?' },
  { name: 'Answer Relevancy', meaning: 'Does the answer address the question?' },
  { name: 'Context Precision', meaning: 'Are the retrieved passages relevant and well ranked?' },
  { name: 'Context Recall', meaning: 'Did retrieval find everything the answer needs?' },
  { name: 'Answer Correctness', meaning: 'Does the answer match the reference answer?' },
];
const RUN_FILE = /^ragas_scores_(\d{8}_\d{6})\.csv$/;
const RUN_ID = /^\d{8}_\d{6}$/;

const toScore = (value) => {
  const number = Number(value);
  return value === '' || value === undefined || Number.isNaN(number) ? null : Math.round(number * 1000) / 1000;
};
const mean = (values) => {
  const scored = values.filter((value) => value !== null);
  return scored.length ? Math.round((scored.reduce((sum, value) => sum + value, 0) / scored.length) * 1000) / 1000 : null;
};
// "20261116_171500" -> "2026-11-16 17:15"
const runLabel = (id) => `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)} ${id.slice(9, 11)}:${id.slice(11, 13)}`;

export function evaluationRoutes({ config }) {
  const router = Router();
  const resultsDir = config.evaluation.resultsDir;

  // List evaluation runs, newest first.
  router.get('/runs', asyncHandler(async (req, res) => {
    const files = await fs.readdir(resultsDir).catch(() => []);
    const runs = files
      .map((file) => file.match(RUN_FILE)?.[1])
      .filter(Boolean)
      .sort()
      .reverse()
      .map((id) => ({ id, label: runLabel(id) }));
    res.json({ runs });
  }));

  // One run: headline averages, averages per question category, and every question.
  router.get('/runs/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!RUN_ID.test(id)) throw httpError(400, 'Invalid run id.'); // also blocks path tricks
    const csv = await fs.readFile(path.join(resultsDir, `ragas_scores_${id}.csv`)).catch(() => null);
    if (!csv) throw httpError(404, 'Evaluation run not found.');

    const records = parse(csv, { columns: true, bom: true, skip_empty_lines: true });
    const metrics = METRICS.filter((metric) => records.length && metric.name in records[0]);
    const rows = records.map((record) => ({
      question: record.user_input || '',
      category: record.question_category || 'uncategorised',
      source: record.source_file || '',
      answer: record.response || '',
      reference: record.reference || '',
      scores: Object.fromEntries(metrics.map((metric) => [metric.name, toScore(record[metric.name])])),
    }));

    const categoryNames = [...new Set(rows.map((row) => row.category))].sort();
    const summary = await fs.readFile(path.join(resultsDir, `ragas_summary_${id}.json`), 'utf8').then(JSON.parse).catch(() => ({}));

    res.json({
      run: { id, label: runLabel(id), questions: rows.length, judge: summary.judge_model || '', embedding: summary.embedding_model || '' },
      metrics: metrics.map((metric) => {
        const values = rows.map((row) => row.scores[metric.name]);
        return { ...metric, mean: mean(values), scored: values.filter((value) => value !== null).length };
      }),
      categories: categoryNames.map((name) => {
        const group = rows.filter((row) => row.category === name);
        return {
          name,
          count: group.length,
          means: Object.fromEntries(metrics.map((metric) => [metric.name, mean(group.map((row) => row.scores[metric.name]))])),
        };
      }),
      rows,
    });
  }));

  return router;
}
