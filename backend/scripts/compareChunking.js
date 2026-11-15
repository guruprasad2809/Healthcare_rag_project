// Compare chunking strategies on the sample documents and the evaluation questions.
//
// To isolate the effect of chunking, retrieval here is plain in-memory BM25 (no
// embedding model, no reranker, no Qdrant), so the script runs anywhere in seconds.
// For each question that has a reference answer in the documents it reports:
//   answer coverage   - share of the reference answer's words found in the top-k chunks
//   intact answers    - share of questions where ONE retrieved chunk holds >= 90% of the answer
//   top-1 right file  - share of questions whose best chunk comes from the correct document
//
// Strategies produce chunks of different sizes, so "top 5 chunks" is not the same amount
// of text for each. By default the script therefore gives every strategy the same context
// budget (--budget, in tokens): chunks are taken in rank order until the budget is used up.
//
// Usage: npm run compare:chunking [-- --budget 1000 --max-tokens 450]
//        npm run compare:chunking -- --k 5        (fixed number of chunks instead of a budget)
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, PROJECT_ROOT } from '../src/config/index.js';
import { parseDocument, isSupported } from '../src/ingestion/parsers/index.js';
import { preprocessBlocks } from '../src/ingestion/preprocess.js';
import { extractMetadata } from '../src/ingestion/metadata.js';
import { chunkDocument } from '../src/ingestion/chunking/index.js';
import { tokenize } from '../src/retrieval/bm25Encoder.js';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? Number(process.argv[index + 1]) : fallback;
};
const K = arg('k', 0);
const BUDGET = arg('budget', 1000);
const config = loadConfig();
const maxTokens = arg('max-tokens', config.chunking.maxTokens);
const SAMPLES = path.join(PROJECT_ROOT, 'data/sample_documents');
const EVAL = path.join(PROJECT_ROOT, 'evaluation/datasets/ragas_eval_dataset.jsonl');

const questions = fs.readFileSync(EVAL, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
  .filter((q) => q.source_file && q.reference_contexts.length);

/** Minimal in-memory BM25 index over chunk texts. */
function buildIndex(chunks) {
  const docs = chunks.map((chunk) => {
    const counts = new Map();
    const tokens = tokenize(chunk.embeddingText);
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    return { counts, length: tokens.length };
  });
  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / docs.length;
  const df = new Map();
  for (const doc of docs) for (const token of doc.counts.keys()) df.set(token, (df.get(token) || 0) + 1);
  return (query, k) => {
    const terms = [...new Set(tokenize(query))];
    return docs
      .map((doc, index) => {
        let score = 0;
        for (const term of terms) {
          const tf = doc.counts.get(term);
          if (!tf) continue;
          const idf = Math.log(1 + (docs.length - df.get(term) + 0.5) / (df.get(term) + 0.5));
          score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * doc.length) / avgLength));
        }
        return { index, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .filter((hit) => hit.score > 0)
      .map((hit) => chunks[hit.index]);
  };
}

const coverage = (referenceTokens, text) => {
  const have = new Set(tokenize(text));
  return referenceTokens.filter((token) => have.has(token)).length / referenceTokens.length;
};

const files = fs.readdirSync(SAMPLES).filter(isSupported).sort();
const parsedDocs = [];
for (const file of files) {
  const buffer = fs.readFileSync(path.join(SAMPLES, file));
  const parsed = await parseDocument(file, buffer);
  parsed.blocks = preprocessBlocks(parsed.blocks);
  parsedDocs.push({ file, blocks: parsed.blocks, title: extractMetadata(file, buffer, parsed).title });
}

const rows = [];
for (const strategy of ['fixed-size', 'recursive', 'semantic-title']) {
  const chunks = [];
  for (const doc of parsedDocs) {
    // semanticSplit is off so no embedding model is needed; long sections fall back to paragraph breaks.
    const docChunks = await chunkDocument(doc.blocks, { ...config.chunking, maxTokens, semanticSplit: false, docTitle: doc.title }, strategy);
    chunks.push(...docChunks.map((chunk) => ({ ...chunk, file: doc.file })));
  }
  const search = buildIndex(chunks);
  let covered = 0;
  let intact = 0;
  let rightFile = 0;
  let retrieved = 0;
  let retrievedTokens = 0;
  for (const question of questions) {
    const reference = [...new Set(tokenize(question.reference))];
    let top = search(question.user_input, K || 50);
    if (!K) { // same token budget for every strategy
      let used = 0;
      top = top.filter((chunk, i) => (used += chunk.tokenEstimate) <= BUDGET || i === 0);
    }
    retrieved += top.length;
    retrievedTokens += top.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);
    covered += coverage(reference, top.map((c) => c.text).join(' '));
    if (top.some((chunk) => coverage(reference, chunk.text) >= 0.9)) intact += 1;
    if (top[0]?.file === question.source_file) rightFile += 1;
  }
  const pct = (value) => `${((100 * value) / questions.length).toFixed(1)}%`;
  rows.push({
    strategy,
    chunks: chunks.length,
    'avg tokens': Math.round(chunks.reduce((sum, c) => sum + c.tokenEstimate, 0) / chunks.length),
    'chunks/question': (retrieved / questions.length).toFixed(1),
    'tokens/question': Math.round(retrievedTokens / questions.length),
    'answer coverage': pct(covered),
    'intact answers': pct(intact),
    'top-1 right file': pct(rightFile),
  });
}

console.log(`\nChunking comparison: ${files.length} documents, ${questions.length} questions, BM25 only, ${K ? `top-${K} chunks` : `context budget ${BUDGET} tokens`}, max ${maxTokens} tokens per chunk\n`);
console.table(rows);
