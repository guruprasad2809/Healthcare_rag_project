// End-to-end test against a real Qdrant: upload -> parse -> chunk -> index -> hybrid
// search -> rerank -> answer, through the HTTP API. Models and Gemini are faked.
// Skipped automatically when Qdrant is not reachable at QDRANT_URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/index.js';
import { createContainer } from '../src/services/container.js';
import { createApp } from '../src/app.js';
import { FakeEmbedder, FakeReranker, FakeLlm } from './helpers/fakes.js';

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/sample_documents');
const config = loadConfig();
config.qdrant.collection = `test_${Date.now()}`;
config.storage.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-test-'));
config.retrieval.minScore = 0;

const llm = new FakeLlm();
const container = createContainer(config, { embedder: new FakeEmbedder(), reranker: new FakeReranker(), llm });
const qdrantUp = await container.store.isHealthy();

test('full pipeline over HTTP', { skip: qdrantUp ? false : `Qdrant not reachable at ${config.qdrant.url}` }, async (t) => {
  const server = createApp(container).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => {
    server.close();
    await container.store.client.deleteCollection(config.qdrant.collection).catch(() => {});
  });

  const upload = async (name) => {
    const form = new FormData();
    form.append('files', new Blob([fs.readFileSync(path.join(SAMPLES, name))]), name);
    return (await fetch(`${base}/documents`, { method: 'POST', body: form })).json();
  };
  const post = async (route, body) => {
    const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };

  await t.test('ingests PDF, DOCX, TXT and CSV', async () => {
    for (const name of ['03_respiratory_conditions_guide.pdf', '07_kidney_and_urinary_health.docx', '12_eye_and_neurological_conditions.txt', '13_disease_descriptions_precautions.csv']) {
      const { results } = await upload(name);
      assert.equal(results[0].status, 'ingested', results[0].error);
      assert.ok(results[0].document.chunkCount > 5);
    }
    const { documents } = await (await fetch(`${base}/documents`)).json();
    assert.equal(documents.length, 4);
    assert.equal(await container.store.count(), documents.reduce((sum, d) => sum + d.chunkCount, 0));
  });

  await t.test('re-uploading the same file replaces it', async () => {
    const before = await container.store.count();
    await upload('13_disease_descriptions_precautions.csv');
    assert.equal(await container.store.count(), before);
  });

  await t.test('rejects unsupported file types', async () => {
    const form = new FormData();
    form.append('files', new Blob(['x']), 'scan.exe');
    const response = await fetch(`${base}/documents`, { method: 'POST', body: form });
    assert.equal(response.status, 415);
  });

  await t.test('hybrid search finds the right section in each format', async () => {
    const cases = [
      ['What causes asthma?', '03_respiratory_conditions_guide.pdf', 'Asthma'],
      ['How are kidney stones diagnosed?', '07_kidney_and_urinary_health.docx', 'Kidney Stones in Adults'],
      ['Who is at risk for glaucoma?', '12_eye_and_neurological_conditions.txt', 'Glaucoma'],
      ['What precautions should be taken for Malaria?', '13_disease_descriptions_precautions.csv', 'Malaria'],
    ];
    for (const [query, file, section] of cases) {
      const { body } = await post('/retrieve', { query });
      assert.equal(body.chunks[0].metadata.fileName, file, query);
      assert.equal(body.chunks[0].metadata.headingPath[0], section, query);
      assert.ok(body.chunks.length <= config.retrieval.topK);
    }
  });

  await t.test('BM25-only and dense-only modes both work', async () => {
    for (const mode of ['bm25', 'dense']) {
      const { body } = await post('/retrieve', { query: 'kidney stones symptoms', mode });
      assert.equal(body.chunks[0].metadata.fileName, '07_kidney_and_urinary_health.docx', mode);
    }
  });

  await t.test('chat returns an answer, numbered sources and RAGAS contexts', async () => {
    const { status, body } = await post('/chat', { question: 'What causes asthma?' });
    assert.equal(status, 200);
    assert.equal(body.answer, 'Test answer [1].');
    assert.equal(body.sources[0].number, 1);
    assert.equal(body.contexts.length, body.sources.length);
    assert.match(llm.calls.at(-1).prompt, /\[1\] Source: 03_respiratory_conditions_guide\.pdf/);
    assert.match(llm.calls.at(-1).systemInstruction, /ONLY the numbered context/);
  });

  await t.test('validates input and deletes documents', async () => {
    assert.equal((await post('/chat', { question: '  ' })).status, 400);
    const { documents } = await (await fetch(`${base}/documents`)).json();
    const target = documents.find((d) => d.fileType === 'csv');
    const before = await container.store.count();
    assert.equal((await fetch(`${base}/documents/${target.docId}`, { method: 'DELETE' })).status, 200);
    assert.equal(await container.store.count(), before - target.chunkCount);
    assert.equal((await fetch(`${base}/documents/${target.docId}`, { method: 'DELETE' })).status, 404);
  });
});
