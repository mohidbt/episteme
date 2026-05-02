from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RetrievedDoc:
    page_content: str
    metadata: dict


class SimpleRetriever:
    def __init__(self, rows: list[dict], *, k: int):
        self._rows = rows
        self._k = k

    async def ainvoke(self, query: str) -> list[RetrievedDoc]:
        _ = query
        out: list[RetrievedDoc] = []
        seen: set[str] = set()
        for row in self._rows:
            chunk_id = str(row.get("chunk_id") or row.get("id") or "")
            if chunk_id in seen:
                continue
            seen.add(chunk_id)
            out.append(
                RetrievedDoc(
                    page_content=str(row.get("content", "")),
                    metadata={
                        "chunk_id": chunk_id,
                        "source_kind": row.get("source_kind"),
                        "source_id": row.get("source_id"),
                        "page": row.get("page"),
                        "score": float(row.get("score", 0.0)),
                    },
                )
            )
            if len(out) >= self._k:
                break
        return out


def build_retriever(
    *,
    rows: list[dict],
    library_id: int,
    kinds: list[str] | None = None,
    source_ids: list[str] | None = None,
    k: int = 8,
):
    _ = library_id
    selected = []
    allowed = set(kinds or ["all"])
    for row in rows:
        if "all" not in allowed and row.get("source_kind") not in allowed:
            continue
        if source_ids and str(row.get("source_id")) not in set(source_ids):
            continue
        selected.append(row)
    selected.sort(key=lambda r: float(r.get("score", 0.0)), reverse=True)
    return SimpleRetriever(selected, k=max(1, min(k, 8)))
