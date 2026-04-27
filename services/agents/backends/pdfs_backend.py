"""PdfsBackend — read-only filesystem adapter over the pdfs tool registry.

Paths:
  /pdfs/<pdf_id>/page<N>.txt  — single page text
  /pdfs/                      — directory listing (returns pdf id strings)

write/delete raise PermissionError — PDFs are ingested via upload, not written
by agents. Use the highlight tool for annotations instead.
"""
import re

from tools.pdfs import get_page_text, list_pdfs

_PAGE_RE = re.compile(r"^/pdfs/([^/]+)/page(\d+)\.txt$")


class PdfsBackend:
    def __init__(self, user_id: str) -> None:
        self._user_id = user_id
        # `user_id` is now read from RunnableConfig.configurable by every tool
        # (see §1.3b-E2E-3).
        self._cfg = {"configurable": {"user_id": user_id}}

    async def read(self, path: str) -> str:
        m = _PAGE_RE.match(path)
        if not m:
            raise ValueError(f"Unrecognised pdfs path: {path!r}. Expected /pdfs/<id>/page<N>.txt")
        pdf_id, page = m.group(1), int(m.group(2))
        result = await get_page_text.ainvoke(
            {"pdf_id": pdf_id, "page": page}, config=self._cfg
        )
        return result["text"]

    async def ls(self, path: str) -> list[str]:
        pdfs = await list_pdfs.ainvoke({}, config=self._cfg)
        return [pdf["id"] for pdf in pdfs]

    async def write(self, path: str, content: str) -> None:
        raise PermissionError("pdfs are read-only; use the highlight tool")

    async def delete(self, path: str) -> None:
        raise PermissionError("pdfs are read-only; use the highlight tool")
