# TMS AI Evaluation Service

Scores submitted reports (PDF/DOCX or typed text) for **grammar** and
**quality**, each 0-5. Runs as a separate Python microservice that the
Node API calls over HTTP after a member submits a report.

## Two model tracks

1. **Baseline (ships by default)** — `train_baseline.py`. TF-IDF +
   hand-crafted grammar features -> GradientBoostingRegressor. Pure
   scikit-learn, trains in seconds, no external downloads. This is what
   `models/` contains out of the box, trained on `dataset.csv`.

2. **Fine-tuned transformer (optional, do this later)** —
   `train_finetune.py`. Fine-tunes DistilBERT on the same data. Needs
   internet access to Hugging Face and `pip install torch transformers
   datasets`. With only ~40 labeled reports this will overfit — treat it
   as a smoke test until your dataset grows past a couple hundred rows.
   Once trained, drop the output in `models/finetuned/` and `predict.py`
   automatically switches to it — no code changes needed elsewhere.

## Setup

```bash
cd ml-service
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python train_baseline.py        # trains + saves models/ (~5 seconds)
uvicorn app:app --host 0.0.0.0 --port 8000
```

Check it's alive:
```bash
curl http://localhost:8000/health
# {"status":"ok","model_mode":"baseline"}
```

## API

- `POST /evaluate` — multipart file upload (`file` field, PDF/DOCX) → `{grammar_score, quality_score, model}`
- `POST /evaluate-text` — JSON `{"text": "..."}` → same shape
- `GET /health` — liveness + which model is active

## Retraining as your dataset grows

Add new labeled rows to `dataset.csv` (same columns as the original),
then just re-run:
```bash
python train_baseline.py
```
It overwrites `models/*.joblib` in place. Restart `uvicorn` to pick up
the new model (or hit `/health` — the service loads models on first
request via a lazy singleton, so a fresh process is the simplest way to
guarantee the new model is used).

## Honest limitations

- Trained on ~40 examples. Grammar scoring generalizes well (validation
  MAE ~0.25/5); quality scoring is noisier (~0.62/5) since "quality" is
  more subjective and harder to learn from few examples.
- The hand-crafted grammar features are heuristics (repeated words,
  missing capitals, vague phrases, run-on sentences), not a full
  grammar parser. They're deliberately simple so the model can learn
  their relationship to your supervisors' actual scores rather than
  depending on a black-box external grammar checker.
- Treat supervisor overrides as new training signal: every time a
  supervisor overrides an AI score, that's a free, high-quality label —
  worth periodically exporting from `ai_evaluations` +
  `supervisor_assessments` back into `dataset.csv` to retrain on.
