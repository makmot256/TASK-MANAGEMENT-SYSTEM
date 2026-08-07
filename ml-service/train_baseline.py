"""
Trains the baseline grammar + quality scorer on dataset.csv.

This is a self-contained model: TF-IDF text features + hand-crafted
grammar/style features -> GradientBoostingRegressor, one per target
(grammar_quality_score, content_quality_score). No external API,
no pretrained weights downloaded — genuinely "our own trained model."

Given the dataset is small (tens of rows), we deliberately use a
shallow, regularized model and report leave-one-out style validation
rather than a single train/test split, since a normal split would be
too noisy to trust with this few rows.

Usage:
    python train_baseline.py
"""
import json
import numpy as np
import pandas as pd
import joblib
from pathlib import Path
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import LeaveOneOut
from sklearn.metrics import mean_absolute_error
from scipy.sparse import hstack, csr_matrix

from features import feature_vector, FEATURE_NAMES

HERE = Path(__file__).parent
DATA_PATH = HERE / "dataset.csv"
MODEL_DIR = HERE / "models"
MODEL_DIR.mkdir(exist_ok=True)

TARGETS = ["grammar_quality_score", "content_quality_score"]


def build_matrix(texts, vectorizer, fit=False):
    if fit:
        tfidf = vectorizer.fit_transform(texts)
    else:
        tfidf = vectorizer.transform(texts)
    hand_feats = np.array([feature_vector(t) for t in texts])
    return hstack([tfidf, csr_matrix(hand_feats)])


def evaluate_loo(X_text, y):
    """Leave-one-out MAE — the most honest metric we can get with ~40 rows."""
    loo = LeaveOneOut()
    preds = np.zeros_like(y, dtype=float)
    for train_idx, test_idx in loo.split(X_text):
        vec = TfidfVectorizer(max_features=200, ngram_range=(1, 2), min_df=1)
        X_train = build_matrix([X_text[i] for i in train_idx], vec, fit=True)
        X_test = build_matrix([X_text[i] for i in test_idx], vec, fit=False)
        model = GradientBoostingRegressor(n_estimators=60, max_depth=2, learning_rate=0.1)
        model.fit(X_train, y[train_idx])
        preds[test_idx] = model.predict(X_test)
    mae = mean_absolute_error(y, preds)
    return mae, preds


def main():
    df = pd.read_csv(DATA_PATH)
    df["report_content"] = df["report_content"].fillna("")
    texts = df["report_content"].tolist()

    print(f"Loaded {len(df)} rows from {DATA_PATH.name}\n")

    metrics = {}
    for target in TARGETS:
        y = df[target].astype(float).values
        mae, preds = evaluate_loo(texts, y)
        metrics[target] = {"loo_mae": round(float(mae), 3)}
        print(f"[{target}] leave-one-out MAE: {mae:.3f} (scale is 0-5)")

        # Fit final model on ALL data for deployment
        vec = TfidfVectorizer(max_features=200, ngram_range=(1, 2), min_df=1)
        X_full = build_matrix(texts, vec, fit=True)
        model = GradientBoostingRegressor(n_estimators=60, max_depth=2, learning_rate=0.1)
        model.fit(X_full, y)

        joblib.dump(vec, MODEL_DIR / f"{target}_vectorizer.joblib")
        joblib.dump(model, MODEL_DIR / f"{target}_model.joblib")

    with open(MODEL_DIR / "metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)

    with open(MODEL_DIR / "feature_names.json", "w") as f:
        json.dump(FEATURE_NAMES, f, indent=2)

    print("\nSaved models to", MODEL_DIR)
    print("\nHONEST NOTE: with ~40 training rows, these MAE numbers will move a lot")
    print("as you add more labeled reports. Treat this as a working v1, not a final model.")


if __name__ == "__main__":
    main()
