"""
Feature engineering for the grammar/quality scorer.

Kept deliberately simple and dependency-light (no external grammar API,
no internet call at inference time) so it can run fully offline once
trained. With a small dataset, hand-crafted signals + TF-IDF generalize
far better than a deep model would.
"""
import re
import numpy as np

VAGUE_PHRASES = [
    "kinda", "sorta", "maybe", "i guess", "will fix later", "not sure",
    "probably", "i think", "sort of", "kind of", "later maybe", "idk",
]

FILLER_WORDS = {"um", "uh", "like", "stuff", "things", "basically", "literally"}


def _sentences(text: str):
    parts = re.split(r"[.!?]+", text)
    return [p.strip() for p in parts if p.strip()]


def _words(text: str):
    return re.findall(r"[A-Za-z']+", text)


def engineer_features(text: str) -> dict:
    text = text or ""
    words = _words(text)
    sents = _sentences(text)
    n_words = max(len(words), 1)
    n_sents = max(len(sents), 1)

    lower = text.lower()

    # Grammar-ish heuristics (cheap, explainable substitutes for a full parser)
    double_space = len(re.findall(r"  +", text))
    missing_capital_starts = sum(1 for s in sents if s and s[0].islower())
    repeated_words = len(re.findall(r"\b(\w+)\s+\1\b", lower))
    lowercase_i = len(re.findall(r"\bi\b", text))  # "i did" instead of "I did"
    run_on_ratio = np.mean([len(_words(s)) for s in sents]) if sents else 0
    no_terminal_punct = 0 if text.strip().endswith((".", "!", "?")) else 1

    vague_hits = sum(lower.count(p) for p in VAGUE_PHRASES)
    filler_hits = sum(1 for w in words if w.lower() in FILLER_WORDS)

    avg_word_len = np.mean([len(w) for w in words]) if words else 0
    unique_ratio = len(set(w.lower() for w in words)) / n_words

    return {
        "n_words": n_words,
        "n_sents": n_sents,
        "avg_sent_len": run_on_ratio,
        "avg_word_len": avg_word_len,
        "unique_word_ratio": unique_ratio,
        "double_space_count": double_space,
        "missing_capital_starts": missing_capital_starts,
        "repeated_word_count": repeated_words,
        "lowercase_i_count": lowercase_i,
        "no_terminal_punct": no_terminal_punct,
        "vague_phrase_count": vague_hits,
        "filler_word_count": filler_hits,
    }


FEATURE_NAMES = list(engineer_features("sample text").keys())


def feature_vector(text: str) -> list:
    feats = engineer_features(text)
    return [feats[k] for k in FEATURE_NAMES]
