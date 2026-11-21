"""Extracción de texto de documentos y partición en fragmentos."""

from __future__ import annotations

import io
import re

from bs4 import BeautifulSoup

TEXT_TYPES = (
    "text/",
    "application/json",
    "application/xml",
    "application/x-yaml",
    "application/javascript",
    "application/x-python",
)
TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".csv", ".json", ".yaml", ".yml", ".xml", ".py", ".kt", ".kts", ".java", ".js",
    ".ts", ".tsx", ".jsx", ".html", ".css", ".sql", ".sh", ".toml", ".ini", ".cfg", ".c", ".cpp", ".h", ".hpp",
    ".cs", ".go", ".rs", ".rb", ".php", ".swift", ".gradle", ".log",
}


class UnsupportedDocument(Exception):
    pass


def extension(path: str) -> str:
    idx = path.rfind(".")
    return path[idx:].lower() if idx >= 0 else ""


def extract_text(data: bytes, content_type: str, path: str) -> str:
    ext = extension(path)
    if content_type == "application/pdf" or ext == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        pages = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if text.strip():
                pages.append(f"[Página {i + 1}]\n{text}")
        return "\n\n".join(pages)
    if ext == ".docx" or content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        from docx import Document

        doc = Document(io.BytesIO(data))
        parts = [p.text for p in doc.paragraphs if p.text.strip()]
        for table in doc.tables:
            for row in table.rows:
                parts.append(" | ".join(cell.text.strip() for cell in row.cells))
        return "\n".join(parts)
    if ext in (".html", ".htm") or content_type == "text/html":
        return html_to_text(data.decode("utf-8", errors="replace"))
    if ext in TEXT_EXTENSIONS or content_type.startswith(TEXT_TYPES):
        return data.decode("utf-8", errors="replace")
    raise UnsupportedDocument(f"Formato no soportado para lectura: {content_type or ext}")


def html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "iframe", "form"]):
        tag.decompose()
    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    text = soup.get_text("\n")
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return (f"# {title}\n\n" if title else "") + text.strip()


def chunk_text(text: str, size: int = 1500, overlap: int = 200) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= size:
        return [text]
    paragraphs = re.split(r"\n\s*\n", text)
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        while len(para) > size:
            head, para = para[:size], para[size - overlap :]
            if current:
                chunks.append(current)
                current = ""
            chunks.append(head)
        if len(current) + len(para) + 2 <= size:
            current = f"{current}\n\n{para}" if current else para
        else:
            if current:
                chunks.append(current)
            tail = current[-overlap:] if current else ""
            current = f"{tail}\n\n{para}" if tail else para
    if current:
        chunks.append(current)
    return chunks
