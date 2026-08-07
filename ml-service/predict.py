"""
Loads the trained baseline model(s) and scores report text.

If a fine-tuned transformer is present (models/finetuned/), that is used
instead — see train_finetune.py. This lets you swap in a better model
later without touching the API contract or the Node integration.
"""
import json
from pathlib import Path
import joblib
import numpy as np
from scipy.sparse import hstack, csr_matrix

from features import feature_vector

HERE = Path(__file__).parent
MODEL_DIR = HERE / "models"
FINETUNED_DIR = MODEL_DIR / "finetuned"

TARGETS = ["grammar_quality_score", "content_quality_score"]


class Scorer:
    def __init__(self):
        self.mode = "finetuned" if FINETUNED_DIR.exists() else "baseline"
        if self.mode == "baseline":
            self.vectorizers = {t: joblib.load(MODEL_DIR / f"{t}_vectorizer.joblib") for t in TARGETS}
            self.models = {t: joblib.load(MODEL_DIR / f"{t}_model.joblib") for t in TARGETS}
        else:
            self._load_finetuned()

    def _load_finetuned(self):
        # Loaded lazily only if train_finetune.py has been run and produced
        # a HF model directory. Kept separate so the baseline path never
        # needs `torch`/`transformers` installed.
        import torch
        from transformers import AutoTokenizer, AutoModelForSequenceClassification

        self.tokenizer = AutoTokenizer.from_pretrained(str(FINETUNED_DIR))
        self.model = AutoModelForSequenceClassification.from_pretrained(str(FINETUNED_DIR))
        self.model.eval()
        self.torch = torch

    def score(self, text: str) -> dict:
        text = (text or "").strip()
        if not text:
            return {"grammar_score": 0.0, "quality_score": 0.0, "note": "Empty document text."}

        if self.mode == "baseline":
            return self._score_baseline(text)
        return self._score_finetuned(text)

    def _score_baseline(self, text: str) -> dict:
        out = {}
        for target in TARGETS:
            vec = self.vectorizers[target]
            model = self.models[target]
            tfidf = vec.transform([text])
            hand = np.array([feature_vector(text)])
            X = hstack([tfidf, csr_matrix(hand)])
            pred = float(model.predict(X)[0])
            pred = max(0.0, min(5.0, pred))
            out[target] = round(pred, 2)
        return {
            "grammar_score": out["grammar_quality_score"],
            "quality_score": out["content_quality_score"],
            "model": "baseline-gbm-tfidf",
        }

    def _score_finetuned(self, text: str) -> dict:
        inputs = self.tokenizer(text, truncation=True, max_length=512, return_tensors="pt")
        with self.torch.no_grad():
            logits = self.model(**inputs).logits.squeeze().tolist()
        # Expect a 2-output regression head: [grammar_score, quality_score]
        grammar, quality = logits[0], logits[1]
        return {
            "grammar_score": round(max(0.0, min(5.0, grammar)), 2),
            "quality_score": round(max(0.0, min(5.0, quality)), 2),
            "model": "finetuned-transformer",
        }


_scorer = None


def get_scorer() -> Scorer:
    global _scorer
    if _scorer is None:
        _scorer = Scorer()
    return _scorer
