from __future__ import annotations

from dataclasses import dataclass
import uuid

try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter
except Exception:  # pragma: no cover - fallback for older envs
    from langchain.text_splitter import RecursiveCharacterTextSplitter  # type: ignore


@dataclass
class Chunk:
    content: str
    metadata: dict


def _mk_chunk_id() -> str:
    return uuid.uuid4().hex


def chunk_markdown_note(
    *,
    note_id: str,
    markdown: str,
    chunk_size: int = 1500,
    chunk_overlap: int = 200,
) -> list[Chunk]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n## ", "\n### ", "\n\n", "\n", " ", ""],
    )
    raw_chunks = splitter.split_text(markdown or "")
    out: list[Chunk] = []
    cursor = 0
    for part in raw_chunks:
        if not part.strip():
            continue
        start = max((markdown or "").find(part, cursor), 0)
        end = start + len(part)
        cursor = max(end - chunk_overlap, start)
        out.append(
            Chunk(
                content=part,
                metadata={
                    "source_kind": "note",
                    "source_id": note_id,
                    "chunk_id": _mk_chunk_id(),
                    "char_range": [start, end],
                },
            )
        )
    return out


def chunk_pdf_pages(
    *,
    paper_id: str,
    pages: list[dict],
    chunk_size: int = 1500,
    chunk_overlap: int = 200,
) -> list[Chunk]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", " ", ""],
    )
    out: list[Chunk] = []
    for page in pages:
        page_number = int(page.get("pageNumber", 0))
        text = str(page.get("text", ""))
        raw_chunks = splitter.split_text(text)
        cursor = 0
        for part in raw_chunks:
            if not part.strip():
                continue
            start = max(text.find(part, cursor), 0)
            end = start + len(part)
            cursor = max(end - chunk_overlap, start)
            out.append(
                Chunk(
                    content=part,
                    metadata={
                        "source_kind": "paper",
                        "source_id": paper_id,
                        "chunk_id": _mk_chunk_id(),
                        "char_range": [start, end],
                        "page": page_number,
                    },
                )
            )
    return out
