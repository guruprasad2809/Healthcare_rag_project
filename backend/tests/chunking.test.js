import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../src/ingestion/parsers/index.js';
import { preprocessBlocks } from '../src/ingestion/preprocess.js';
import { semanticTitleChunk, buildSections } from '../src/ingestion/chunking/semanticTitleChunker.js';
import { fixedSizeChunk, recursiveChunk } from '../src/ingestion/chunking/baselineChunkers.js';
import { classifyLine } from '../src/ingestion/chunking/headingDetector.js';
import { FakeEmbedder } from './helpers/fakes.js';

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/sample_documents');
const load = async (name) => {
  const parsed = await parseDocument(name, fs.readFileSync(path.join(SAMPLES, name)));
  return preprocessBlocks(parsed.blocks);
};
const H = (level, text) => ({ type: 'heading', level, text });
const P = (text) => ({ type: 'paragraph', text });

test('heading detector recognises common healthcare heading styles', () => {
  assert.equal(classifyLine('## What is asthma?').level, 2);
  assert.equal(classifyLine('ASSESSMENT:').style, 'label');
  assert.equal(classifyLine('PAST MEDICAL HISTORY').style, 'caps');
  assert.equal(classifyLine('2. Methods', { prevBlank: true }).style, 'numbered-1');
  assert.equal(classifyLine('What causes anemia?', { prevBlank: true, nextBlank: true }).style, 'question');
  assert.equal(classifyLine('1. She will try Zyrtec instead of Allegra again.', { prevBlank: true }), null);
  assert.equal(classifyLine('The patient was given two sprays in each nostril.', { prevBlank: true, nextBlank: true }), null);
});

test('sections keep their full heading path', () => {
  const sections = buildSections([H(0, 'Guide'), H(1, 'Asthma'), H(2, 'Causes'), P('Genes and environment.'), H(2, 'Treatment'), P('Inhalers.'), H(1, 'COPD'), P('Lung disease.')]);
  assert.deepEqual(sections.map((s) => s.path), [['Asthma', 'Causes'], ['Asthma', 'Treatment'], ['COPD']]);
});

test('every chunk carries document title and heading path in the embedded text', async () => {
  const body = 'Asthma is caused by a mix of inherited and environmental factors that interact early in life. '.repeat(3);
  const chunks = await semanticTitleChunk([H(0, 'Lung Guide'), H(1, 'Asthma'), H(2, 'What causes asthma?'), P(body)], { docTitle: 'Lung Guide' });
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0].headingPath, ['Asthma', 'What causes asthma?']);
  assert.ok(chunks[0].embeddingText.startsWith('Lung Guide > Asthma > What causes asthma?\n'));
});

test('tiny sibling sections are merged and keep their titles', async () => {
  const chunks = await semanticTitleChunk(
    [H(1, 'Report 1'), H(2, 'Medications'), P('Allegra.'), H(2, 'Allergies'), P('None known.'), H(2, 'Assessment'), P('Allergic rhinitis.')],
    { docTitle: 'Notes', minTokens: 40 },
  );
  assert.equal(chunks.length, 1);
  assert.match(chunks[0].text, /Medications\nAllegra\./);
  assert.match(chunks[0].text, /Assessment\nAllergic rhinitis\./);
  assert.deepEqual(chunks[0].headingPath.slice(0, 1), ['Report 1']);
});

test('long sections are split between sentences and stay under the size limit', async () => {
  const sentences = [];
  for (let i = 0; i < 40; i += 1) sentences.push(i < 20 ? `Insulin dose number ${i} lowers blood glucose in diabetes.` : `Kidney stone number ${i} causes flank pain and urine blockage.`);
  const chunks = await semanticTitleChunk([H(1, 'Mixed topic'), P(sentences.join(' '))], { docTitle: 'Doc', maxTokens: 150, embedder: new FakeEmbedder() });
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.tokenEstimate <= 150, `chunk has ${chunk.tokenEstimate} tokens`);
    assert.match(chunk.text, /[.?!]$/, 'chunk ends at a sentence boundary');
    assert.deepEqual(chunk.headingPath, ['Mixed topic']);
  }
  assert.equal(chunks.map((c) => c.text).join(' ').replace(/\s+/g, ' '), sentences.join(' '), 'no text lost or duplicated');
});

test('sample documents: structure is recovered in every format', async () => {
  const expectations = {
    '01_diabetes_patient_guide.pdf': ['Diabetes', 'Diabetic Retinopathy'],
    '05_infectious_diseases_guide.docx': ['Malaria', 'Rabies'],
    '10_clinical_notes_sleep_medicine.txt': ['REPORT 1: VIDEO EEG - 2'],
    '12_eye_and_neurological_conditions.txt': ['Glaucoma', 'Migraine'],
    '13_disease_descriptions_precautions.csv': ['Malaria', 'Migraine'],
  };
  for (const [file, titles] of Object.entries(expectations)) {
    const blocks = await load(file);
    const chunks = await semanticTitleChunk(blocks, { docTitle: 'Doc' });
    const firstLevel = new Set(chunks.map((c) => c.headingPath[0]));
    for (const title of titles) assert.ok(firstLevel.has(title), `${file}: missing top-level section "${title}"`);
    assert.ok(Math.max(...chunks.map((c) => c.tokenEstimate)) <= 520, `${file}: chunk too large`);
  }
});

test('baseline chunkers produce size-bounded chunks without structure', async () => {
  const blocks = await load('07_kidney_and_urinary_health.docx');
  for (const chunks of [fixedSizeChunk(blocks, { maxTokens: 300 }), recursiveChunk(blocks, { maxTokens: 300 })]) {
    assert.ok(chunks.length > 5);
    assert.ok(chunks.every((c) => c.tokenEstimate <= 320 && c.headingPath.length === 0));
  }
});
