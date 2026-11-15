import test from 'node:test';
import assert from 'node:assert/strict';
import { Bm25Encoder, tokenize, termId } from '../src/retrieval/bm25Encoder.js';
import { Reranker } from '../src/retrieval/reranker.js';
import { buildPrompt, formatContext } from '../src/generation/prompt.js';
import { splitSentences } from '../src/utils/text.js';

test('tokenizer lowercases, drops stopwords and folds plurals', () => {
  assert.deepEqual(tokenize('What are the Symptoms of Type 2 diabetes?'), ['symptom', 'type', '2', 'diabete']);
  assert.deepEqual(tokenize('diabetes'), tokenize('Diabetes.'));
});

test('BM25 document vectors saturate term frequency; query terms weigh 1', () => {
  const bm25 = new Bm25Encoder({ avgDocLength: 10 });
  const once = bm25.encodeDocument('insulin lowers glucose');
  const many = bm25.encodeDocument('insulin insulin insulin insulin lowers glucose');
  const id = termId('insulin');
  const weight = (v) => v.values[v.indices.indexOf(id)];
  assert.ok(weight(many) > weight(once));
  assert.ok(weight(many) < 2.2, 'bounded by k1 + 1');
  const query = bm25.encodeQuery('insulin insulin dose');
  assert.equal(query.indices.length, 2);
  assert.ok(query.values.every((v) => v === 1));
  assert.deepEqual([...once.indices].sort((a, b) => a - b), once.indices, 'indices are sorted');
});

test('reranker sorts by cross-encoder score, filters weak matches and pads batches', async () => {
  const batchSizes = [];
  const loader = async () => ({
    tokenizer: (queries, { text_pair }) => ({ queries, text_pair }),
    model: async ({ text_pair }) => {
      batchSizes.push(text_pair.length);
      return { logits: { tolist: () => text_pair.map((p) => [p.includes('asthma') ? 4 : -6]) } };
    },
  });
  const reranker = new Reranker({ enabled: true, model: 'fake', dtype: 'q8', batchSize: 4, maxLength: 512 }, { loader });
  const candidates = ['kidney stones', 'asthma causes', 'migraine', 'asthma triggers', 'anemia'].map((text) => ({ text }));
  const ranked = await reranker.rerank('what causes asthma', candidates, { topK: 3, minScore: 0.1 });
  assert.deepEqual(ranked.map((c) => c.text), ['asthma causes', 'asthma triggers']);
  assert.ok(ranked[0].rerankScore > 0.9);
  assert.deepEqual(batchSizes, [4, 4], 'last batch is padded to full size');
});

test('prompt numbers the passages and names their source', () => {
  const chunk = { text: 'Asthma has no cure.', metadata: { fileName: 'guide.pdf', docTitle: 'Guide', headingPath: ['Asthma', 'Outlook'], page: 3 } };
  const context = formatContext([chunk]);
  assert.match(context, /^\[1\] Source: guide\.pdf, page 3\nSection: Guide > Asthma > Outlook\nAsthma has no cure\./);
  assert.match(buildPrompt('Is there a cure?', []), /no relevant passages/);
});

test('sentence splitter keeps abbreviations and decimals together', () => {
  assert.deepEqual(splitSentences('Take 2.5 mg daily. See Dr. Rao if pain persists. Rest well.'), ['Take 2.5 mg daily.', 'See Dr. Rao if pain persists.', 'Rest well.']);
});
