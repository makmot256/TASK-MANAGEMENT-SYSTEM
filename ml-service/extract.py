"""Extracts plain text from PDF or DOCX files for scoring."""
from pathlib import Path


def extract_text(file_path: str) -> str:
    ext = Path(file_path).suffix.lower()
    if ext == ".pdf":
        return _extract_pdf(file_path)
    if ext in (".docx", ".doc"):
        return _extract_docx(file_path)
    raise ValueError(f"Unsupported file type: {ext}")


def _extract_pdf(file_path: str) -> str:
    import pdfplumber
    text_parts = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text() or ""
            text_parts.append(t)
    return "\n".join(text_parts).strip()


def _extract_docx(file_path: str) -> str:
    import docx
    d = docx.Document(file_path)
    return "\n".join(p.text for p in d.paragraphs).strip()
