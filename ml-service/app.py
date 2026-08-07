"""
AI evaluation microservice for the Task Management System.

Exposes:
  POST /evaluate         - multipart file upload (pdf/docx) -> scores
  POST /evaluate-text    - JSON {"text": "..."} -> scores  (used when a
                            member typed content directly, no file)
  GET  /health           - liveness check

Run:
    uvicorn app:app --host 0.0.0.0 --port 8000

The Node server calls this over HTTP after a submission is created
(see server/src/services/ai-evaluation.service.js).
"""
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel

from extract import extract_text
from predict import get_scorer

app = FastAPI(title="TMS AI Evaluation Service")


class TextIn(BaseModel):
    text: str


@app.get("/health")
def health():
    scorer = get_scorer()
    return {"status": "ok", "model_mode": scorer.mode}


@app.post("/evaluate-text")
def evaluate_text(payload: TextIn):
    scorer = get_scorer()
    result = scorer.score(payload.text)
    return result


@app.post("/evaluate")
async def evaluate_file(file: UploadFile = File(...)):
    suffix = Path(file.filename).suffix.lower()
    if suffix not in (".pdf", ".docx", ".doc"):
        raise HTTPException(400, f"Unsupported file type: {suffix}")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        text = extract_text(tmp_path)
    except Exception as e:
        raise HTTPException(422, f"Could not extract text from document: {e}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    if not text.strip():
        raise HTTPException(422, "No extractable text found in document (may be a scanned image).")

    scorer = get_scorer()
    result = scorer.score(text)
    result["extracted_chars"] = len(text)
    return result
