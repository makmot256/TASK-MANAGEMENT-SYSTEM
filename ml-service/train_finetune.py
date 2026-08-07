"""
Fine-tunes a small open-source transformer (DistilBERT) to predict
grammar_quality_score and content_quality_score directly from report text.

NOT run in this sandbox — it needs to download pretrained weights from
Hugging Face Hub, which requires normal internet access. Run this on your
own machine, a lab PC, or Google Colab.

Why this is separate from train_baseline.py:
  - train_baseline.py works TODAY with your 40 rows and needs nothing
    but scikit-learn — that's what ships in ml-service by default.
  - This script gives you a genuine fine-tuned neural model once you've
    grown the dataset. With only ~40 examples, a transformer will likely
    just memorize the training set (watch the eval loss vs train loss
    below) — treat anything under ~200-300 labeled reports as a dry run,
    not a deployable model.

Install (separately from requirements.txt, only when you're ready):
    pip install torch transformers datasets --break-system-packages

Usage:
    python train_finetune.py

Output:
    models/finetuned/  <- point predict.py at this; app.py auto-detects it
"""
import numpy as np
import pandas as pd
import torch
from pathlib import Path
from sklearn.model_selection import train_test_split
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
)
from datasets import Dataset

HERE = Path(__file__).parent
DATA_PATH = HERE / "dataset.csv"
OUT_DIR = HERE / "models" / "finetuned"

BASE_MODEL = "distilbert-base-uncased"  # small, fast, well-suited to this task size
TARGETS = ["grammar_quality_score", "content_quality_score"]


def main():
    df = pd.read_csv(DATA_PATH)
    df["report_content"] = df["report_content"].fillna("")
    # Model output is 2 numbers: [grammar_score, quality_score], both 0-5
    df["labels"] = df[TARGETS].astype(float).values.tolist()

    if len(df) < 150:
        print(f"WARNING: only {len(df)} rows. Fine-tuning will likely overfit.")
        print("Treat this run as a pipeline smoke test, not a model you deploy.\n")

    train_df, eval_df = train_test_split(df, test_size=0.2, random_state=42)
    train_ds = Dataset.from_pandas(train_df[["report_content", "labels"]])
    eval_ds = Dataset.from_pandas(eval_df[["report_content", "labels"]])

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)

    def tokenize(batch):
        return tokenizer(batch["report_content"], truncation=True, padding="max_length", max_length=256)

    train_ds = train_ds.map(tokenize, batched=True)
    eval_ds = eval_ds.map(tokenize, batched=True)

    model = AutoModelForSequenceClassification.from_pretrained(
        BASE_MODEL, num_labels=2, problem_type="regression"
    )

    def compute_metrics(eval_pred):
        preds, labels = eval_pred
        mae = np.mean(np.abs(preds - labels))
        return {"mae": mae}

    args = TrainingArguments(
        output_dir=str(HERE / "checkpoints"),
        num_train_epochs=8,
        per_device_train_batch_size=4,
        per_device_eval_batch_size=4,
        learning_rate=2e-5,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="mae",
        greater_is_better=False,
        logging_steps=5,
    )

    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
        compute_metrics=compute_metrics,
    )

    trainer.train()
    metrics = trainer.evaluate()
    print("\nFinal eval metrics:", metrics)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(OUT_DIR))
    tokenizer.save_pretrained(str(OUT_DIR))
    print(f"\nSaved fine-tuned model to {OUT_DIR}")
    print("Restart the ml-service (uvicorn app:app) — it will auto-detect and use this model.")


if __name__ == "__main__":
    main()
