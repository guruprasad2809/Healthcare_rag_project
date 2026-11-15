# Healthcare RAG Application

Upload healthcare documents (PDF, DOCX, TXT, Markdown, CSV), ask questions, and get answers
that come only from those documents, with the sources shown for every answer.

| Part | Choice |
|---|---|
| LLM | Gemini (model ID set by `GEMINI_MODEL`) |
| Embedding model | Qwen3-Embedding-0.6B |
| Reranker | BAAI/bge-reranker-v2-m3 |
| Chunking | Semantic Title-Based Chunking |
| Retrieval | Hybrid search: BM25 + vector embeddings, fused with RRF, then reranked |
| Vector database | Qdrant |
| Evaluation | RAGAS (5 metrics) |
| Backend | Node.js (Express) |
| Frontend | HTML, CSS, JavaScript (no framework) |

> **About "Gemini 4 Hydrogen":** this model has no public API model ID yet, so it cannot be
> called today. The model is one line in `.env` (`GEMINI_MODEL`). It is set to
> `gemini-3.8-flash` for now; put the Hydrogen model ID there when Google releases it.

## How it works

```
                 ┌────────────────────────── INGESTION ──────────────────────────┐
 upload ──► parse (PDF/DOCX/TXT/CSV) ──► clean ──► metadata ──► semantic title-based
            chunking ──► Qwen3 embedding + BM25 sparse vector ──► Qdrant

                 ┌────────────────────────── RETRIEVAL ──────────────────────────┐
 question ──► Qwen3 query embedding ─┐
          └─► BM25 query vector ─────┴─► Qdrant hybrid search (RRF fusion, top 20)
                                          ──► bge-reranker-v2-m3 (top 5)

                 ┌────────────────────────── GENERATION ─────────────────────────┐
 top 5 chunks + question ──► grounded prompt ──► Gemini ──► answer with [1][2] citations
```

## Project structure

```
├── backend/                  Node.js API and RAG pipeline
│   ├── src/
│   │   ├── config/           all settings, read from .env in one place
│   │   ├── api/              Express routes and middleware
│   │   ├── ingestion/        parsers, preprocessing, metadata, chunking, ingestion pipeline
│   │   ├── retrieval/        BM25 encoder, reranker, retriever (hybrid + rerank)
│   │   ├── generation/       Gemini client and prompt
│   │   ├── services/         embedder, Qdrant store, document registry, RAG pipeline, wiring
│   │   └── utils/
│   ├── scripts/              ingest sample documents, compare chunking strategies
│   └── tests/                unit tests + end-to-end test against Qdrant
├── frontend/                 upload + chat UI (index.html, css/, js/)
├── data/sample_documents/    15 healthcare documents (4 PDF, 4 DOCX, 4 TXT, 3 CSV)
├── evaluation/               RAGAS script, evaluation dataset, results
├── docs/                     implementation plan and chunking analysis
├── docker-compose.yml        Qdrant
└── .env.example
```

## Setup

You need Node.js 20+, Docker (for Qdrant) and, for evaluation only, Python 3.10+.

```bash
# 1. Settings
cp .env.example .env          # then put your key after GEMINI_API_KEY=

# 2. Vector database
docker compose up -d

# 3. Backend + frontend
cd backend
npm install
npm start                     # http://localhost:3000
```

The first start downloads the embedding and reranker models (roughly 1 GB with the default
`q8` setting) into `storage/models`. The status line in the top-left of the page turns to
"Ready" when everything is loaded.

Load the 15 sample documents (or upload your own in the browser):

```bash
cd backend
npm run ingest:samples
```

If a model fails to load:

- Check the internet connection; the weights come from Hugging Face on the first start.
- If the `q8` files are not offered for a model, set `EMBEDDING_DTYPE` or `RERANKER_DTYPE`
  in `.env` to another type the model page lists (for example `fp32`, `fp16` or `q4`).
- If `npm install` fails on a restricted network while fetching GPU files, run
  `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install`.

## The 15 sample documents

| # | File | Format | Content |
|---|---|---|---|
| 01 | diabetes_patient_guide | PDF | Diabetes, diabetic retinopathy, kidney disease of diabetes, prediabetes |
| 02 | heart_and_blood_pressure_guide | PDF | High blood pressure, coronary heart disease, heart attack, heart failure, stroke |
| 03 | respiratory_conditions_guide | PDF | Asthma, COPD, pneumonia, bronchitis |
| 04 | clinical_reports_allergy_immunology | PDF | Sample clinical reports with sections (Subjective, Assessment, Plan...) |
| 05 | infectious_diseases_guide | DOCX | TB, malaria, dengue, typhoid, rabies, hepatitis B, chickenpox, flu |
| 06 | digestive_health_guide | DOCX | Gallstones, celiac disease, ulcerative colitis, peptic ulcer, IBS, constipation |
| 07 | kidney_and_urinary_health | DOCX | Kidney stones, urinary tract infection, chronic kidney disease, kidney failure |
| 08 | blood_disorders_guide | DOCX | Anemia, iron-deficiency anemia, hemophilia, DVT, thalassemias, sickle cell |
| 09 | pubmed_research_abstracts | TXT | 30 structured research abstracts |
| 10 | clinical_notes_sleep_medicine | TXT | Sample clinical notes with ALL-CAPS section labels |
| 11 | consumer_health_questions | TXT | 40 real consumer health questions with reference answers |
| 12 | eye_and_neurological_conditions | TXT | Glaucoma, cataract, migraine, Parkinson's, Alzheimer's, epilepsy |
| 13 | disease_descriptions_precautions | CSV | 41 diseases with description and precautions |
| 14 | symptom_severity_weights | CSV | 131 symptoms with a severity weight |
| 15 | medication_questions_answers | CSV | 250 questions about medicines with answers |

Sources: NIH MedQuAD, MTSamples (de-identified sample transcriptions, not real patients),
PubMedQA, TREC LiveQA 2017, MedicationQA and a public disease-symptom dataset. The text is
the original text; only the file format is new. For education and research use.

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | Status of Qdrant, models and the Gemini key |
| POST | `/api/documents` | Upload files (form field `files`), ingest them |
| GET | `/api/documents` | List ingested documents |
| DELETE | `/api/documents/:docId` | Remove a document and its chunks |
| POST | `/api/chat` | `{ "question": "..." }` → answer, sources, contexts |
| POST | `/api/retrieve` | `{ "query": "...", "mode": "hybrid\|dense\|bm25" }` → chunks only, no LLM |

## Tests

```bash
cd backend
npm test
```

Unit tests need nothing else. The end-to-end test runs when Qdrant is reachable and uses
small fake models and a fake LLM, so it needs no downloads and no API key.

## RAGAS evaluation

```bash
cd evaluation
pip install -r requirements.txt
python ragas_evaluate.py            # add --limit 10 for a quick run
```

The backend must be running with the sample documents ingested. The script asks all 59
questions in `evaluation/datasets/ragas_eval_dataset.jsonl`, then scores Faithfulness,
Answer Relevancy, Context Precision, Context Recall and Answer Correctness. Scores are
saved in `evaluation/results/` as a CSV (one row per question) and a JSON summary
(overall and per question category). Six of the questions are out of scope on purpose:
the right behaviour there is to say "the documents do not cover this".

## More documentation

- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): the four modules, with tasks, steps, tools and expected outcomes
- [docs/CHUNKING_ANALYSIS.md](docs/CHUNKING_ANALYSIS.md): why semantic title-based chunking, and how it compares with fixed-size and recursive chunking

## Limits to know about

- Scanned PDFs (images of text) are not read; they need OCR first.
- PDF headings are found from font size, so a PDF with two-column pages or with headings
  the same size as the body text will chunk less cleanly.
- The document list is a JSON file (`storage/documents.json`). For several backend
  instances, replace `DocumentRegistry` with a database table.
- This is an information tool, not a medical device. It does not diagnose or prescribe.
