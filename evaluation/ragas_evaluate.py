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
    python ragas_evaluate.py --sample 15     # 15 questions spread over all categories
    python ragas_evaluate.py                 # all questions
    python ragas_evaluate.py --answers results/answers_XXXX.json   # re-score saved answers
    python ragas_evaluate.py --answers results/answers_XXXX.json --metrics answer_relevancy
                                             # re-score one metric and fill it into that run

Free Gemini keys have small per-minute and per-day limits. The script therefore
sends judge requests one at a time, capped at --rpm requests per minute, and saves
the app's answers before scoring so a failed run can be re-scored without asking
the app again. Budget roughly 15 Gemini requests per question.

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
    parser.add_argument("--username", default=os.getenv("RAG_API_USERNAME") or os.getenv("APP_USERNAME", "admin"), help="app login, if the app has a password")
    parser.add_argument("--password", default=os.getenv("RAG_API_PASSWORD") or os.getenv("APP_PASSWORD", ""), help="app password (default: APP_PASSWORD from .env)")
    parser.add_argument("--output-dir", default=str(ROOT / "evaluation/results"))
    parser.add_argument("--limit", type=int, default=0, help="evaluate only the first N questions")
    parser.add_argument("--sample", type=int, default=0, help="evaluate N questions spread evenly over the question categories")
    parser.add_argument("--rpm", type=float, default=8, help="max Gemini requests per minute (answers and judge)")
    parser.add_argument("--workers", type=int, default=1, help="parallel judge requests (keep 1 on a free key)")
    parser.add_argument("--metrics", default="", help="score only these metrics, comma separated, e.g. answer_relevancy")
    parser.add_argument("--answers", default="", help="re-score a saved answers_*.json file instead of asking the app again")
    parser.add_argument("--judge-model", default=os.getenv("RAGAS_JUDGE_MODEL") or os.getenv("GEMINI_MODEL", "gemini-3.8-flash"))
    parser.add_argument("--embedding-model", default=os.getenv("RAGAS_EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B"))
    return parser.parse_args()


def resolve_metrics(text):
    """Turn "--metrics answer_relevancy,faithfulness" into RAGAS metric names; empty means all."""
    if not text:
        return None
    short = {"context_precision": "llm_context_precision_with_reference"}
    by_label = {label.lower().replace(" ", "_"): key for key, label in METRIC_COLUMNS.items()}
    wanted = []
    for item in text.split(","):
        key = item.strip().lower().replace(" ", "_").replace("-", "_")
        key = short.get(key, by_label.get(key, key))
        if key not in METRIC_COLUMNS:
            sys.exit(f"Unknown metric '{item.strip()}'. Choose from: {', '.join(by_label)}")
        wanted.append(key)
    return wanted


def load_dataset(path, limit, sample):
    rows = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    if sample and sample < len(rows):
        # Round-robin over the categories so a small run still covers every kind of question.
        by_category = {}
        for row in rows:
            by_category.setdefault(row.get("question_category", ""), []).append(row)
        picked = []
        while len(picked) < sample:
            for group in by_category.values():
                if group and len(picked) < sample:
                    picked.append(group.pop(0))
        rows = picked
    return rows[:limit] if limit else rows


def collect_answers(rows, api_url, rpm, auth=None):
    """Ask the RAG backend every question and record its answer and retrieved contexts."""
    api_url = api_url.rstrip("/")
    health = requests.get(f"{api_url}/api/health", timeout=30).json()
    if health.get("documents", 0) == 0:
        sys.exit("No documents are ingested. Run `npm run ingest:samples` in backend/ first.")
    if health.get("status") != "ready":
        sys.exit(f"Backend is not ready yet: {health}")

    samples = []
    for index, row in enumerate(rows, 1):
        result = ask_backend(api_url, row["user_input"], auth)
        samples.append({
            "user_input": row["user_input"],
            "response": result["answer"],
            # RAGAS needs at least one context string; an empty retrieval is recorded as such.
            "retrieved_contexts": result["contexts"] or ["(no context retrieved)"],
            "reference": row["reference"],
        })
        print(f"[{index}/{len(rows)}] {row['user_input'][:70]}")
        time.sleep(60 / rpm)
    return samples


def ask_backend(api_url, question, auth=None, attempts=4):
    """POST one question; wait and retry when Gemini's per-minute limit is hit."""
    for attempt in range(1, attempts + 1):
        response = requests.post(f"{api_url}/api/chat", json={"question": question}, auth=auth, timeout=300)
        if response.ok:
            return response.json()
        if response.status_code == 401:
            sys.exit("\nThe app asked for a login. Pass --password (and --username), or set APP_PASSWORD in .env.")
        message = response.json().get("error", response.text) if response.content else response.reason
        if "per day" in message or "PerDay" in message:
            sys.exit(f"\nGemini's daily free limit is used up for this model:\n{message[:400]}\n"
                     "Switch GEMINI_MODEL in .env (and restart the app) or continue tomorrow.")
        if attempt == attempts:
            sys.exit(f"\nThe app could not answer: {message[:400]}")
        print(f"  request failed ({response.status_code}), retrying in 30s...")
        time.sleep(30)


def run_ragas(samples, judge_model, embedding_model, rpm, workers, only=None):
    from langchain_core.rate_limiters import InMemoryRateLimiter
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_huggingface import HuggingFaceEmbeddings
    from ragas import EvaluationDataset, RunConfig, evaluate
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

    # The limiter spaces judge requests so the per-minute quota is never exceeded.
    limiter = InMemoryRateLimiter(requests_per_second=rpm / 60, check_every_n_seconds=0.2, max_bucket_size=1)
    # bypass_n: Answer Relevancy needs several generated questions. Without this RAGAS asks
    # Gemini for several candidates in one request, which Gemini rejects, and the metric
    # comes back empty. With it, the same prompt is simply sent once per question needed.
    judge = LangchainLLMWrapper(
        ChatGoogleGenerativeAI(model=judge_model, temperature=0, google_api_key=api_key, rate_limiter=limiter),
        bypass_n=True,
    )
    embeddings = LangchainEmbeddingsWrapper(HuggingFaceEmbeddings(model_name=embedding_model))

    metrics = [Faithfulness(), ResponseRelevancy(), LLMContextPrecisionWithReference(), LLMContextRecall(), AnswerCorrectness()]
    if only:
        metrics = [metric for metric in metrics if metric.name in only]

    return evaluate(
        dataset=EvaluationDataset.from_list(samples),
        metrics=metrics,
        llm=judge,
        embeddings=embeddings,
        run_config=RunConfig(max_workers=workers, timeout=300, max_retries=6, max_wait=90),
    )


def main():
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    only = resolve_metrics(args.metrics)

    if args.answers:
        answers_path = Path(args.answers)
        saved = json.loads(answers_path.read_text(encoding="utf-8"))
        rows, samples = saved["rows"], saved["samples"]
        # Keep the original run's time stamp so its result files are updated, not duplicated.
        if answers_path.stem.startswith("answers_"):
            stamp = answers_path.stem[len("answers_"):]
        print(f"Re-scoring {len(rows)} saved answers from {args.answers} (judge: {args.judge_model})")
        if only:
            print(f"Only: {', '.join(METRIC_COLUMNS[name] for name in only)}")
        print()
    else:
        rows = load_dataset(args.dataset, args.limit, args.sample)
        minutes = len(rows) * 15 / args.rpm
        print(f"Evaluating {len(rows)} questions against {args.api_url} (judge: {args.judge_model})")
        print(f"About {len(rows) * 15} Gemini requests, roughly {minutes:.0f} minutes at {args.rpm:g} requests/minute.\n")
        samples = collect_answers(rows, args.api_url, args.rpm, (args.username, args.password) if args.password else None)
        answers_file = output_dir / f"answers_{stamp}.json"
        answers_file.write_text(json.dumps({"rows": rows, "samples": samples}, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nAnswers saved to {answers_file}\nScoring with RAGAS (this is the slow part)...\n")

    result = run_ragas(samples, args.judge_model, args.embedding_model, args.rpm, args.workers, only)

    scores = result.to_pandas().rename(columns=METRIC_COLUMNS)
    scores["question_category"] = [row.get("question_category", "") for row in rows]
    scores["source_file"] = [row.get("source_file", "") for row in rows]

    # When only some metrics were re-scored, fill them into the run's existing results.
    scores_file = output_dir / f"ragas_scores_{stamp}.csv"
    if only and scores_file.exists():
        previous = pd.read_csv(scores_file)
        if len(previous) == len(scores) and list(previous["user_input"]) == list(scores["user_input"]):
            for name in (METRIC_COLUMNS[key] for key in only):
                previous[name] = scores[name].values
            scores = previous
    metric_names = [name for name in METRIC_COLUMNS.values() if name in scores.columns]

    scores.to_csv(scores_file, index=False)

    summary = {
        "timestamp": stamp,
        "questions": len(rows),
        "judge_model": args.judge_model,
        "embedding_model": args.embedding_model,
        "overall": scores[metric_names].mean().round(3).to_dict(),
        "unscored": {name: int(scores[name].isna().sum()) for name in metric_names},
        "by_category": scores.groupby("question_category")[metric_names].mean().round(3).to_dict(orient="index"),
    }
    (output_dir / f"ragas_summary_{stamp}.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("\n===== RAGAS results (0 to 1, higher is better) =====")
    for name, value in summary["overall"].items():
        print(f"{name:<20} {value:.3f}")
    failed = {name: count for name, count in summary["unscored"].items() if count}
    if failed:
        print(f"\nNot scored (judge request failed, left out of the averages): {failed}")
        print(f"Re-run later with:  python ragas_evaluate.py --answers {output_dir / f'answers_{stamp}.json'}" if not args.answers else "")
    print("\nBy question category:")
    print(pd.DataFrame(summary["by_category"]).T.to_string())
    print(f"\nSaved to {output_dir}/ragas_scores_{stamp}.csv and ragas_summary_{stamp}.json")


if __name__ == "__main__":
    main()
