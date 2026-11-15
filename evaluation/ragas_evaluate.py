"""
RAGAS evaluation of the Healthcare RAG application.

For every question in the evaluation set this script asks the running backend
(POST /api/chat), collects the generated answer and the retrieved contexts, and
scores them with five RAGAS metrics:

  1. Faithfulness        - is the answer supported by the retrieved contexts?
  2. Answer Relevancy    - does the answer address the question?
  3. Context Precision   - are the retrieved contexts relevant (and ranked well)?
  4. Context Recall      - did retrieval find everything the reference answer needs?
  5. Answer Correctness  - does the answer match the reference answer?

Usage (backend must be running and the sample documents ingested):
    pip install -r requirements.txt
    python ragas_evaluate.py                 # all questions
    python ragas_evaluate.py --limit 10      # quick run

Keys are read from the project .env file (GEMINI_API_KEY). Gemini is the judge LLM;
Qwen3-Embedding-0.6B provides the embeddings RAGAS needs for answer relevancy and
answer correctness.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

METRIC_COLUMNS = {
    "faithfulness": "Faithfulness",
    "answer_relevancy": "Answer Relevancy",
    "llm_context_precision_with_reference": "Context Precision",
    "context_recall": "Context Recall",
    "answer_correctness": "Answer Correctness",
}


def parse_args():
    parser = argparse.ArgumentParser(description="Evaluate the Healthcare RAG app with RAGAS")
    parser.add_argument("--dataset", default=str(ROOT / "evaluation/datasets/ragas_eval_dataset.jsonl"))
    parser.add_argument("--api-url", default=os.getenv("RAG_API_URL", f"http://localhost:{os.getenv('PORT', '3000')}"))
    parser.add_argument("--output-dir", default=str(ROOT / "evaluation/results"))
    parser.add_argument("--limit", type=int, default=0, help="evaluate only the first N questions")
    parser.add_argument("--judge-model", default=os.getenv("RAGAS_JUDGE_MODEL") or os.getenv("GEMINI_MODEL", "gemini-3.8-flash"))
    parser.add_argument("--embedding-model", default=os.getenv("RAGAS_EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B"))
    parser.add_argument("--pause", type=float, default=0.0, help="seconds to wait between questions (API rate limits)")
    return parser.parse_args()


def load_dataset(path, limit):
    rows = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    return rows[:limit] if limit else rows


def collect_answers(rows, api_url, pause):
    """Ask the RAG backend every question and record its answer and retrieved contexts."""
    health = requests.get(f"{api_url}/api/health", timeout=30).json()
    if health.get("documents", 0) == 0:
        sys.exit("No documents are ingested. Run `npm run ingest:samples` in backend/ first.")
    if health.get("status") != "ready":
        sys.exit(f"Backend is not ready yet: {health}")

    samples = []
    for index, row in enumerate(rows, 1):
        response = requests.post(f"{api_url}/api/chat", json={"question": row["user_input"]}, timeout=300)
        response.raise_for_status()
        result = response.json()
        samples.append({
            "user_input": row["user_input"],
            "response": result["answer"],
            # RAGAS needs at least one context string; an empty retrieval is recorded as such.
            "retrieved_contexts": result["contexts"] or ["(no context retrieved)"],
            "reference": row["reference"],
        })
        print(f"[{index}/{len(rows)}] {row['user_input'][:70]}")
        time.sleep(pause)
    return samples


def run_ragas(samples, judge_model, embedding_model):
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_huggingface import HuggingFaceEmbeddings
    from ragas import EvaluationDataset, evaluate
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from ragas.llms import LangchainLLMWrapper
    from ragas.metrics import (
        AnswerCorrectness,
        Faithfulness,
        LLMContextPrecisionWithReference,
        LLMContextRecall,
        ResponseRelevancy,
    )

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        sys.exit("GEMINI_API_KEY is not set in .env (needed for the RAGAS judge LLM).")

    judge = LangchainLLMWrapper(ChatGoogleGenerativeAI(model=judge_model, temperature=0, google_api_key=api_key))
    embeddings = LangchainEmbeddingsWrapper(HuggingFaceEmbeddings(model_name=embedding_model))

    return evaluate(
        dataset=EvaluationDataset.from_list(samples),
        metrics=[Faithfulness(), ResponseRelevancy(), LLMContextPrecisionWithReference(), LLMContextRecall(), AnswerCorrectness()],
        llm=judge,
        embeddings=embeddings,
    )


def main():
    args = parse_args()
    rows = load_dataset(args.dataset, args.limit)
    print(f"Evaluating {len(rows)} questions against {args.api_url} (judge: {args.judge_model})\n")

    samples = collect_answers(rows, args.api_url, args.pause)
    result = run_ragas(samples, args.judge_model, args.embedding_model)

    scores = result.to_pandas().rename(columns=METRIC_COLUMNS)
    scores["question_category"] = [row.get("question_category", "") for row in rows]
    scores["source_file"] = [row.get("source_file", "") for row in rows]
    metric_names = [name for name in METRIC_COLUMNS.values() if name in scores.columns]

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    scores.to_csv(output_dir / f"ragas_scores_{stamp}.csv", index=False)

    summary = {
        "timestamp": stamp,
        "questions": len(rows),
        "judge_model": args.judge_model,
        "embedding_model": args.embedding_model,
        "overall": scores[metric_names].mean().round(3).to_dict(),
        "by_category": scores.groupby("question_category")[metric_names].mean().round(3).to_dict(orient="index"),
    }
    (output_dir / f"ragas_summary_{stamp}.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("\n===== RAGAS results (0 to 1, higher is better) =====")
    for name, value in summary["overall"].items():
        print(f"{name:<20} {value:.3f}")
    print("\nBy question category:")
    print(pd.DataFrame(summary["by_category"]).T.to_string())
    print(f"\nSaved to {output_dir}/ragas_scores_{stamp}.csv and ragas_summary_{stamp}.json")


if __name__ == "__main__":
    main()
