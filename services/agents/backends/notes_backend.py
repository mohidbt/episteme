"""NotesBackend — routes deepagents filesystem ops to KM /api/notes + /api/folders.

Phase 1.3e Task 2: minimal `awrite` + bootstrap. Other ops (`aread`, `aedit`,
`als`, `aglob`, `agrep`) land in subsequent tasks; they raise NotImplementedError
explicitly so the gap is visible.

Mounted by `km_agent` under `/.episteme/agents/memories/` via CompositeBackend.
The composite strips the route prefix before delegating, so paths arriving here
look like `/preferences.md` or `/research/transformers.md`.
"""
from __future__ import annotations

import asyncio
import re

from deepagents.backends.protocol import BackendProtocol, ReadResult, WriteResult

from lib.km_http import km_get, km_post

_AGENT_FOLDER_SEGMENTS: tuple[str, ...] = (".episteme", "agents", "memories")
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    base = _SLUG_RE.sub("-", name.lower()).strip("-")
    return base or "untitled"


def _split_path(path: str) -> tuple[list[str], str]:
    """`/research/transformers.md` -> (['research'], 'transformers')."""
    parts = [p for p in path.strip("/").split("/") if p]
    if not parts:
        raise ValueError(f"NotesBackend got empty path {path!r}")
    filename = parts[-1]
    subfolders = parts[:-1]
    if filename.endswith(".md"):
        filename = filename[:-3]
    return subfolders, _slugify(filename)


class NotesBackend(BackendProtocol):
    """Persists agent memories as real notes under `.episteme/agents/memories/`."""

    def __init__(self, *, user_id: str) -> None:
        self.user_id = user_id
        self._library_id: int | None = None
        # segments-tuple -> folderId (str). Root sentinel (`()`) maps to None.
        self._folder_ids: dict[tuple[str, ...], str | None] = {(): None}
        self._lock = asyncio.Lock()

    async def _bootstrap(self) -> str:
        """Resolve default library and ensure `.episteme/agents/memories` chain.

        Returns the leaf (`memories`) folderId.
        """
        async with self._lock:
            if self._library_id is None:
                resp = await km_get("/api/folders", user_id=self.user_id)
                if not isinstance(resp, dict) or resp.get("error") or "libraryId" not in resp:
                    raise RuntimeError(
                        f"NotesBackend: could not resolve default library for user {self.user_id}: {resp!r}"
                    )
                self._library_id = resp["libraryId"]
                # Seed cache with any pre-existing top-level folders so we
                # don't create duplicates if the user already has `.episteme`.
                for f in resp.get("folders") or []:
                    if f.get("parentId") is None and f.get("name"):
                        self._folder_ids[(f["name"],)] = f["id"]
            return await self._ensure_folder_chain(_AGENT_FOLDER_SEGMENTS)

    async def _ensure_folder_chain(self, segments: tuple[str, ...]) -> str:
        """Walk-or-create each segment under default library. Returns leaf folderId."""
        assert self._library_id is not None
        parent_id: str | None = None
        cur: tuple[str, ...] = ()
        for seg in segments:
            cur = cur + (seg,)
            cached = self._folder_ids.get(cur)
            if cached is not None:
                parent_id = cached
                continue
            # Look up siblings under parent_id.
            qs = f"libraryId={self._library_id}"
            if parent_id is not None:
                qs += f"&parentId={parent_id}"
            listing = await km_get(f"/api/folders?{qs}", user_id=self.user_id)
            existing_id: str | None = None
            if isinstance(listing, dict) and not listing.get("error"):
                for f in listing.get("folders") or []:
                    if f.get("name") == seg and f.get("parentId") == parent_id:
                        existing_id = f.get("id")
                        break
            if existing_id is not None:
                parent_id = existing_id
            else:
                created = await km_post(
                    "/api/folders",
                    {"libraryId": self._library_id, "parentId": parent_id, "name": seg},
                    user_id=self.user_id,
                )
                if not isinstance(created, dict) or created.get("error") or "id" not in created:
                    raise RuntimeError(
                        f"NotesBackend: failed to create folder {seg!r} under {parent_id!r}: {created!r}"
                    )
                parent_id = created["id"]
            self._folder_ids[cur] = parent_id
        assert parent_id is not None
        return parent_id

    # -- BackendProtocol async surface -----------------------------------

    async def awrite(self, file_path: str, content: str) -> WriteResult:
        leaf = await self._bootstrap()
        subfolders, slug = _split_path(file_path)
        if subfolders:
            full = _AGENT_FOLDER_SEGMENTS + tuple(subfolders)
            leaf = await self._ensure_folder_chain(full)
        body = {
            "libraryId": self._library_id,
            "folderId": leaf,
            "title": slug,
            "contentMd": content,
        }
        resp = await km_post("/api/notes", body, user_id=self.user_id)
        if isinstance(resp, dict) and resp.get("error"):
            return WriteResult(error=str(resp))
        return WriteResult(error=None, path=file_path)

    async def aread(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        leaf = await self._bootstrap()
        subfolders, slug = _split_path(file_path)
        if subfolders:
            full = _AGENT_FOLDER_SEGMENTS + tuple(subfolders)
            leaf = await self._ensure_folder_chain(full)
        # GET filters by libraryId only; we filter client-side. memories
        # folder is small (agent-managed), so this is acceptable per plan.
        listing = await km_get(
            f"/api/notes?libraryId={self._library_id}",
            user_id=self.user_id,
        )
        if isinstance(listing, dict) and listing.get("error"):
            return ReadResult(error=str(listing))
        rows = listing if isinstance(listing, list) else []
        match = next(
            (r for r in rows if r.get("folderId") == leaf and r.get("title") == slug),
            None,
        )
        if match is None:
            return ReadResult(error="file_not_found")
        return ReadResult(
            error=None,
            file_data={
                "content": match.get("contentMd") or "",
                "encoding": "utf-8",
            },
        )

    async def aedit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False):
        raise NotImplementedError("Phase 1.3e Task 4")

    async def als(self, path: str):
        raise NotImplementedError("Phase 1.3e Task 5")

    async def aglob(self, pattern: str, path: str = "/"):
        raise NotImplementedError("Phase 1.3e Task 5")

    async def agrep(self, pattern: str, path: str | None = None, glob: str | None = None):
        raise NotImplementedError("Phase 1.3e Task 5")

    async def aupload_files(self, files):
        raise NotImplementedError

    async def adownload_files(self, paths):
        raise NotImplementedError
