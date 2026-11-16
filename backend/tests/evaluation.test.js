import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { evaluationRoutes } from '../src/api/routes/evaluation.routes.js';
import { errorHandler } from '../src/api/middleware/errorHandler.js';

test('evaluation API lists runs and summarises scores', async (t) => {
  const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-'));
  fs.writeFileSync(path.join(resultsDir, 'ragas_scores_20261116_171500.csv'),
    'user_input,response,reference,Faithfulness,Answer Correctness,question_category,source_file\n'
    + '"What is asthma?","A lung disease, [1].","A lung disease.",1.0,0.8,health_info,03.pdf\n'
    + '"Who won?","Not covered.","Should refuse.",0.5,,out_of_scope,\n');
  fs.writeFileSync(path.join(resultsDir, 'ragas_summary_20261116_171500.json'), JSON.stringify({ judge_model: 'judge-x' }));
  fs.writeFileSync(path.join(resultsDir, 'answers_20261116_171500.json'), '{}');

  const app = express();
  app.use('/api/evaluation', evaluationRoutes({ config: { evaluation: { resultsDir } } }));
  app.use(errorHandler);
  const server = app.listen(0);
  t.after(() => server.close());
  const get = async (route) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/evaluation${route}`);
    return { status: response.status, body: await response.json() };
  };

  const list = await get('/runs');
  assert.deepEqual(list.body.runs, [{ id: '20261116_171500', label: '2026-11-16 17:15' }]);

  const { body } = await get('/runs/20261116_171500');
  assert.equal(body.run.judge, 'judge-x');
  assert.deepEqual(body.metrics.map((m) => [m.name, m.mean, m.scored]), [['Faithfulness', 0.75, 2], ['Answer Correctness', 0.8, 1]]);
  assert.deepEqual(body.categories.map((c) => c.name), ['health_info', 'out_of_scope']);
  assert.equal(body.rows[1].scores['Answer Correctness'], null);

  assert.equal((await get('/runs/20990101_000000')).status, 404);
  assert.equal((await get('/runs/..%2F..%2Fsecret')).status, 400);
});
