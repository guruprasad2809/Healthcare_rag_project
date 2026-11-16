# Implementation Plan: Four Modules

Each module below lists its tasks, the steps to build it, the tools it uses, and what you
should see when it works. File paths point to where each step lives in this repository.

---

## Module 1: Frontend

**Goal:** a simple page where a user uploads healthcare documents and asks questions.

### Tasks
1. Page layout: a sidebar for documents, a main area for chat.
2. File upload by drag-and-drop or file picker, several files at once.
3. Document list with file type, chunk count and a remove button.
4. Chat: question box, answer, numbered sources under each answer.
5. Status line showing whether the database, models and API key are ready.

### Steps
1. `frontend/index.html`: write the page structure (sidebar, drop zone, document list, messages, question form).
2. `frontend/css/styles.css`: style it with CSS variables for colours; add a mobile layout with a media query.
3. `frontend/js/api.js`: one small function per backend endpoint, all using `fetch`.
4. `frontend/js/render.js`: turn an answer into safe HTML. Escape everything first, then add paragraphs, lists, bold text and clickable `[1]` citation chips.
5. `frontend/js/app.js`:
   - upload files one by one and show "processing…", then the chunk count or the error;
   - reload the document list after each upload or removal;
   - on submit, show the question, a spinner, then the answer and its sources;
   - clicking a citation opens the sources and highlights that passage;
   - poll `/api/health` and update the status line.
6. The backend serves this folder as static files, so there is no build step.

### Tools
HTML5, CSS3, JavaScript (ES modules), Fetch API, FormData.

### Expected outcome
Opening `http://localhost:3000` shows the page. Dropping a PDF adds it to the list with its
chunk count. Asking a question returns an answer with citations, and each citation opens
the exact passage, file name, section path and page it came from.

---

## Module 2: Data Ingestion

**Goal:** turn an uploaded file into searchable chunks stored in Qdrant.

### Tasks
1. File upload handling and validation.
2. Document parsing and text extraction for PDF, DOCX, TXT/MD and CSV.
3. Preprocessing (cleaning).
4. Metadata extraction.
5. Semantic title-based chunking.
6. Embedding generation with Qwen3-Embedding-0.6B and storage in Qdrant.

### Steps
1. **Upload** (`backend/src/api/middleware/upload.js`): accept multipart uploads with `multer`, keep files in memory, limit the size, reject unsupported extensions.
2. **Parse** (`backend/src/ingestion/parsers/`): every parser returns the same thing, a list of blocks that are either a `heading` (with a level) or a `paragraph`.
   - `pdfParser.js`: read text with `pdfjs-dist`, group it into lines, find the body font size, and treat lines in a larger font as headings (bigger font = higher level). Remove page numbers and repeated headers/footers.
   - `docxParser.js`: convert with `mammoth`, which keeps Word's real Title and Heading 1–6 styles.
   - `textParser.js`: detect Markdown `#` headings, underlined headings, numbered headings, `LABEL:` lines, ALL CAPS lines and question lines (`chunking/headingDetector.js`).
   - `csvParser.js`: each row becomes a small section whose title is the row's name column, with the cells written as `column: value`.
3. **Preprocess** (`preprocess.js`): normalise Unicode, fix ligatures and quotes, remove control characters, repair words hyphenated across lines, collapse extra spaces.
4. **Metadata** (`metadata.js`): document ID (hash of the file, so the same file is never stored twice), file name and type, title, author, pages or rows, word count, upload time.
5. **Chunk** (`chunking/semanticTitleChunker.js`):
   - build sections from headings and keep each section's full heading path;
   - merge very small neighbouring sections; attach a tiny lead-in to the section it introduces;
   - split a section that is too long between sentences, at the points where the topic changes most (lowest embedding similarity between neighbouring sentences);
   - put "document title > heading path" in front of the text that gets embedded.
6. **Embed and store** (`ingestionPipeline.js`, `services/embedder.js`, `services/qdrantStore.js`): embed each chunk with Qwen3-Embedding-0.6B (1024 numbers per chunk), build its BM25 sparse vector, and upsert both with the chunk text and metadata into Qdrant. Record the document in the registry.

### Tools
`multer`, `pdfjs-dist`, `mammoth`, `csv-parse`, `@huggingface/transformers` (runs the ONNX build of Qwen3-Embedding-0.6B inside Node.js), `@qdrant/js-client-rest`, Qdrant.

### Expected outcome
`npm run ingest:samples` loads all 15 sample documents. Every chunk in Qdrant has a dense
vector, a BM25 sparse vector, its text, and metadata (file, title, heading path, page).
No chunk is larger than the limit (450 tokens by default), and no chunk cuts a sentence.

---

## Module 3: Data Retrieval

**Goal:** for a question, find the few passages that best answer it.

### Tasks
1. Keyword search with BM25.
2. Semantic search with vector embeddings.
3. Fusion of the two result lists (hybrid search).
4. Reranking with a cross-encoder (ms-marco-MiniLM-L-6-v2 by default, BAAI/bge-reranker-v2-m3 optional).

### Steps
1. **BM25** (`backend/src/retrieval/bm25Encoder.js`): tokenise text (lowercase, drop stopwords), give each term an ID by hashing, and compute the BM25 term weight. Qdrant stores these as sparse vectors and applies the IDF part itself (`modifier: idf`), so rare terms such as drug names count for more.
2. **Vector search** (`services/embedder.js`): embed the question with Qwen3-Embedding-0.6B using its query instruction prefix.
3. **Hybrid search** (`services/qdrantStore.js`): send one Qdrant query with two prefetches (dense top 20, BM25 top 20) fused with Reciprocal Rank Fusion. A chunk ranked well by either method rises to the top.
4. **Rerank** (`retrieval/reranker.js`): score each of the 20 candidates together with the question using the cross-encoder reranker, sort by that score, drop very weak matches, keep the top 5.
5. **Retriever** (`retrieval/retriever.js`): runs steps 1–4 and returns chunks with scores, metadata and timings. `POST /api/retrieve` exposes it without the LLM so retrieval can be checked on its own, in `hybrid`, `dense` or `bm25` mode.

### Tools
Qdrant Query API (prefetch + RRF fusion, sparse vectors), `@huggingface/transformers` (ONNX cross-encoder reranker), Qwen3-Embedding-0.6B.

### Expected outcome
`POST /api/retrieve` with "What causes asthma?" returns up to 5 chunks, the first from the
Asthma section of the respiratory guide, each with a rerank score between 0 and 1. Exact
terms (drug names, lab values) are found through BM25 even when the wording differs, and
reworded questions are found through embeddings even when no keyword matches.

---

## Module 4: Backend

**Goal:** connect everything: the API, the RAG pipeline and Gemini.

### Tasks
1. Configuration and service wiring.
2. REST API for documents, chat, retrieval and health.
3. Gemini integration with a grounded prompt.
4. The full RAG pipeline.
5. Error handling, tests and evaluation hooks.

### Steps
1. **Config** (`backend/src/config/index.js`): read every setting from `.env` once. No other file reads environment variables.
2. **Wiring** (`services/container.js`): create each service once and pass it to the parts that need it. Tests swap in fake models here.
3. **Routes** (`api/routes/`): `documents.routes.js` (upload, list, delete), `chat.routes.js` (chat, retrieve), `health.routes.js`. Input is validated; errors become clear JSON messages (`api/middleware/errorHandler.js`).
4. **Prompt** (`generation/prompt.js`): number the retrieved passages, label each with file and section, and instruct the model to answer only from them, cite them, say when the documents do not cover a question, never diagnose or guess doses, and point to emergency care when needed.
5. **Gemini** (`generation/geminiClient.js`): call the model named in `GEMINI_MODEL` through the `@google/genai` SDK.
6. **RAG pipeline** (`services/ragPipeline.js`): question → retriever → prompt → Gemini → `{ answer, sources, contexts, timings }`. `contexts` is the list RAGAS needs.
7. **Server** (`app.js`, `server.js`): serve the API and the frontend, and load the models in the background at start-up.
8. **Evaluation** (`evaluation/ragas_evaluate.py`): call `/api/chat` for every test question and score the five RAGAS metrics.

### Tools
Node.js 20+, Express, `@google/genai`, `dotenv`, `cors`, Node's built-in test runner, Docker Compose (Qdrant), Python + RAGAS for evaluation.

### Expected outcome
`npm start` serves the app on port 3000. `POST /api/chat` returns a cited answer in a few
seconds. `npm test` passes. `python evaluation/ragas_evaluate.py` produces the five RAGAS
scores overall and per question category.

---

## How the modules fit together

| Step | Module | Entry point |
|---|---|---|
| User uploads a file | Frontend → Backend | `POST /api/documents` |
| File becomes chunks in Qdrant | Data Ingestion | `IngestionPipeline.ingest()` |
| User asks a question | Frontend → Backend | `POST /api/chat` |
| Best passages are found | Data Retrieval | `Retriever.retrieve()` |
| Answer is written from those passages | Backend | `RagPipeline.ask()` |
| Quality is measured | Evaluation | `ragas_evaluate.py` |

## Growing the project later

- **New file format:** write one parser that returns blocks and add it to `parsers/index.js`.
- **New chunking strategy:** add a function to `chunking/index.js`.
- **Different LLM, embedder or reranker:** change the model ID in `.env`, or replace one class; nothing else changes because services are passed in, not imported directly.
- **More load:** run several backend instances behind a load balancer, run Qdrant as a cluster, move model inference to a GPU service, and move the document registry to a database.
