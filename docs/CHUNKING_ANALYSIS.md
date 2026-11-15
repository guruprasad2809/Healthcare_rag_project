# Chunking Analysis: Why Semantic Title-Based Chunking

## What the strategy does

A chunk is the unit that gets embedded, searched and handed to the LLM. Semantic
title-based chunking builds chunks in four steps
(`backend/src/ingestion/chunking/semanticTitleChunker.js`):

1. **Title step.** Headings split the document into sections. Each section remembers its
   full heading path, for example `Respiratory Conditions Guide > Asthma > What causes Asthma?`.
2. **Merge step.** Very small neighbouring sections under the same parent are joined
   (for example `Medications`, `Allergies` and `Vitals` in a clinical note), and each keeps its own title inside the chunk.
3. **Semantic step.** A section longer than the limit is split between sentences, at the
   places where neighbouring sentences are least similar in meaning (measured with the
   embedding model). A sentence is never cut.
4. **Context step.** The document title and heading path are placed in front of the chunk
   text before it is embedded and keyword-indexed.

## Why it suits healthcare documents

**Healthcare documents are written around titles.** Patient guides follow "What is it? /
Causes / Symptoms / Diagnosis / Treatment / Prevention". Clinical notes follow "History /
Medications / Assessment / Plan". Research abstracts follow "Background / Methods /
Results / Conclusion". Drug leaflets follow "Uses / Dosage / Side effects / Warnings".
The heading is the author's own statement of what the text below it answers, and user
questions line up with those headings ("What causes asthma?", "What was the plan?").

**The same sentence means different things under different headings.** "Take 500 mg twice
a day" is useless, or dangerous, without knowing which drug and which condition it sits
under. "Family history: diabetes" is not the same fact as "Assessment: diabetes". A chunk
that carries its heading path keeps that meaning attached.

**Medical text is full of pronouns and short forms.** A section body often says "it",
"this condition" or "the patient" and never repeats the disease name. Without the title, a
chunk about asthma triggers may not contain the word "asthma" at all, so neither keyword
search nor the embedding can connect it to an asthma question.

**Mixing sections is a safety problem, not just a quality problem.** If a chunk starts in
the middle of "Side effects" for one drug and ends in "Dosage" for the next, the LLM can
attach the wrong dose to the wrong drug. Section boundaries are the natural firewall.

**Clinical notes have many tiny sections.** "Allergies: none known." is too small to be a
useful chunk alone. Merging small siblings under the same report keeps them together with
their labels instead of scattering one-line chunks.

## How it improves retrieval accuracy

| Effect | Why |
|---|---|
| Better keyword match (BM25) | Title words such as the disease or drug name are in every chunk of that section, so exact-term search finds them. |
| Better semantic match (embeddings) | One chunk = one topic, so its vector is not a blur of two topics. The title in front tells the model what the passage is about. |
| Better reranking | The reranker reads "title path + passage" together with the question, the same way a person would judge relevance. |
| More complete answers | A whole answer sits in one chunk instead of being cut in two, which helps Context Recall and Answer Correctness. |
| Less noise for the LLM | Chunks do not drag in the end of the previous section or the start of the next, which helps Context Precision and Faithfulness. |
| Traceable sources | Every answer can cite file, section path and page. |

## Where other methods underperform

### Fixed-size chunking
Cuts every N characters, whatever the text says.

- Cuts sentences, lists and tables in half. A dose can be separated from its drug name, a
  precaution list from the disease it belongs to.
- A chunk often holds the end of one topic and the start of another, so its embedding
  represents neither well.
- Overlap is used to patch the cuts, which stores the same text twice and returns
  near-duplicate chunks.
- No title is attached, so a chunk from the middle of a section may never name its subject.
- Tiny clinical sections get glued to whatever comes next; long ones get cut at a random point.

### Recursive chunking
Splits on paragraphs first, then lines, then sentences, then words, and packs pieces up to
the size limit. It is a clear step up from fixed-size, because it respects paragraphs.

- It sees a heading as just another short line. Packing can leave a heading at the end of
  one chunk and its text at the start of the next.
- Packing to a size target still merges unrelated neighbouring sections ("Symptoms" of one
  disease with "Treatment" of another) when they are short.
- It knows nothing about hierarchy: "Causes" is stored without knowing it means "Causes of
  Asthma".
- When a long section must be split, it splits at the size limit, not where the topic changes.
- CSV rows and structured notes lose their row or label boundaries.

### Where semantic title-based chunking is weaker
It is fair to list these too:

- It depends on finding headings. Documents with no headings, scanned PDFs, or PDFs whose
  headings look like body text fall back to sentence-level semantic splitting only.
- It produces more, smaller chunks, so the index is larger (see below).
- Semantic splitting of long sections costs extra embedding calls during ingestion.
- A question that needs facts from several sections needs several chunks to be retrieved.

## Measured comparison on this project's data

`npm run compare:chunking` (in `backend/`) chunks the 15 sample documents with each
strategy and runs the 53 evaluation questions that have an answer in the documents.

To isolate chunking, retrieval in this test is **BM25 only**: no embedding model, no
reranker. Because the strategies make chunks of different sizes, every strategy gets the
**same context budget** in tokens, filled with its best-ranked chunks.

- *Answer coverage*: share of the reference answer's words that appear in the retrieved text.
- *Intact answers*: share of questions where a single retrieved chunk holds at least 90% of the answer.

| Context budget | Strategy | Chunks in index | Avg tokens per chunk | Answer coverage | Intact answers |
|---|---|---|---|---|---|
| 500 tokens | Fixed-size | 345 | 442 | 76.2% | 62.3% |
| 500 tokens | Recursive | 401 | 387 | 78.0% | 69.8% |
| 500 tokens | **Semantic title-based** | 785 | 164 | **93.0%** | **90.6%** |
| 1000 tokens | Fixed-size | 345 | 442 | 90.8% | 83.0% |
| 1000 tokens | Recursive | 401 | 387 | 93.8% | 90.6% |
| 1000 tokens | **Semantic title-based** | 785 | 164 | **95.4%** | **94.3%** |
| 2000 tokens | Fixed-size | 345 | 442 | 98.1% | 90.6% |
| 2000 tokens | Recursive | 401 | 387 | 99.5% | 100.0% |
| 2000 tokens | Semantic title-based | 785 | 164 | 99.5% | 100.0% |

What this shows:

- With a small context budget, title-based chunks find far more of the answer, because
  each chunk is one focused section instead of a large block of mixed text.
- As the budget grows, the gap closes. With 2000 tokens of context, recursive chunking
  catches up, at the price of sending the LLM more text that is not needed.
- Fixed-size chunking stays behind on intact answers at every budget, because it cuts
  answers in two.

What this does **not** show, so the numbers are not over-read:

- It is a small test (53 questions, 15 documents) with keyword search only. It does not
  include the Qwen3 embeddings or the reranker, and it is not a RAGAS score.
- Most sample documents are question-and-answer style, where one section holds one answer.
  That structure favours title-based chunking. Documents with long unstructured prose
  would show a smaller difference.
- Semantic splitting of long sections was switched off for this test (it needs the
  embedding model), so long sections were split at paragraph breaks.

For the full picture, run the RAGAS evaluation (`evaluation/ragas_evaluate.py`) with the
real models.

## Settings

| Setting (`.env`) | Default | Meaning |
|---|---|---|
| `CHUNK_MAX_TOKENS` | 450 | Largest chunk; longer sections are split semantically |
| `CHUNK_MIN_TOKENS` | 40 | Sections smaller than this are merged with neighbours |
| `CHUNK_MERGE_TARGET_TOKENS` | 200 | Size at which a group of merged small sections is closed |
| `CHUNK_SEMANTIC_SPLIT` | true | Use embedding similarity to choose split points in long sections |
