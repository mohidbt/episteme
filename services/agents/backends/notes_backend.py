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

from deepagents.backends.protocol import (
    BackendProtocol,
    EditResult,
    GlobResult,
    GrepResult,
    LsResult,
    ReadResult,
    WriteResult,
)

from lib.km_http import km_get, km_patch, km_post

_AGENT_FOLDER_SEGMENTS: tuple[str, ...] = (".episteme", "agents", "memories")
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    base = _SLUG_RE.sub("-", name.lower()).strip("-")
    return base or "untitled"


def _glob_match(pattern: str, path: str) -> bool:
    """Match `path` against a glob `pattern` with `**` recursive support.

    Translates `**` to match any number of path segments (including zero),
    `*` to non-slash chars, then defers to fnmatch.translate for the rest.
    """
    # Build a regex piece by piece, escaping non-glob chars.
    i = 0
    out = ["(?s:"]
    while i < len(pattern):
        c = pattern[i]
        if c == "*":
            if i + 1 < len(pattern) and pattern[i + 1] == "*":
                # `**/` or trailing `**`
                if i + 2 < len(pattern) and pattern[i + 2] == "/":
                    out.append("(?:.*/)?")
                    i += 3
                else:
                    out.append(".*")
                    i += 2
                continue
            out.append("[^/]*")
            i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        elif c in ".+(){}|^$\\":
            out.append("\\" + c)
            i += 1
        else:
            out.append(re.escape(c) if not c.isalnum() and c not in "/-_" else c)
            i += 1
    out.append(")\\Z")
    return re.match("".join(out), path) is not None


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

    async def bootstrap(self) -> str:
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
            return await self.ensure_folder_chain(_AGENT_FOLDER_SEGMENTS)

    async def ensure_folder_chain(self, segments: tuple[str, ...]) -> str:
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

    # Back-compat aliases (one cycle); prefer the public names above.
    _bootstrap = bootstrap
    _ensure_folder_chain = ensure_folder_chain

    # -- BackendProtocol async surface -----------------------------------

    async def awrite(self, file_path: str, content: str) -> WriteResult:
        leaf = await self.bootstrap()
        subfolders, slug = _split_path(file_path)
        if subfolders:
            full = _AGENT_FOLDER_SEGMENTS + tuple(subfolders)
            leaf = await self.ensure_folder_chain(full)
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

    async def _get_note_row(self, file_path: str) -> dict | None:
        """Return the raw note row matching file_path, or None if missing."""
        leaf = await self.bootstrap()
        subfolders, slug = _split_path(file_path)
        if subfolders:
            full = _AGENT_FOLDER_SEGMENTS + tuple(subfolders)
            leaf = await self.ensure_folder_chain(full)
        listing = await km_get(
            f"/api/notes?libraryId={self._library_id}",
            user_id=self.user_id,
        )
        if isinstance(listing, dict) and listing.get("error"):
            return None
        rows = listing if isinstance(listing, list) else []
        return next(
            (r for r in rows if r.get("folderId") == leaf and r.get("title") == slug),
            None,
        )

    async def aread(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        match = await self._get_note_row(file_path)
        if match is None:
            return ReadResult(error="file_not_found")
        return ReadResult(
            error=None,
            file_data={
                "content": match.get("contentMd") or "",
                "encoding": "utf-8",
            },
        )

    async def aedit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        match = await self._get_note_row(file_path)
        if match is None:
            return EditResult(error="file_not_found")
        content = match.get("contentMd") or ""
        if replace_all:
            occurrences = content.count(old_string)
            new_content = content.replace(old_string, new_string)
        else:
            occurrences = 1 if old_string in content else 0
            new_content = content.replace(old_string, new_string, 1)
        if occurrences == 0:
            return EditResult(error="string_not_found", path=file_path, occurrences=0)
        resp = await km_patch(
            f"/api/notes/{match['id']}",
            {"contentMd": new_content},
            user_id=self.user_id,
        )
        if isinstance(resp, dict) and resp.get("error"):
            return EditResult(error=str(resp))
        return EditResult(error=None, path=file_path, occurrences=occurrences)

    # -- helpers for ls/glob/grep ----------------------------------------

    def _path_segments(self, path: str) -> tuple[str, ...]:
        """Backend-relative path -> tuple of segments (no leading/trailing slash)."""
        return tuple(p for p in (path or "").strip("/").split("/") if p)

    def _full_segments(self, path: str) -> tuple[str, ...]:
        """Backend-relative path -> full segment tuple incl. memories prefix."""
        return _AGENT_FOLDER_SEGMENTS + self._path_segments(path)

    async def _resolve_folder_id(self, path: str) -> str:
        """Resolve backend-relative path to its folderId (creating if missing)."""
        full = self._full_segments(path)
        return await self.ensure_folder_chain(full)

    async def _list_subfolders(self, parent_id: str) -> list[dict]:
        """GET children folders under parent_id, scoped to default library."""
        assert self._library_id is not None
        qs = f"libraryId={self._library_id}&parentId={parent_id}"
        listing = await km_get(f"/api/folders?{qs}", user_id=self.user_id)
        if not isinstance(listing, dict) or listing.get("error"):
            return []
        return [
            f for f in (listing.get("folders") or [])
            if f.get("parentId") == parent_id
        ]

    async def _list_all_notes(self) -> list[dict]:
        assert self._library_id is not None
        listing = await km_get(
            f"/api/notes?libraryId={self._library_id}",
            user_id=self.user_id,
        )
        if isinstance(listing, dict) and listing.get("error"):
            return []
        return listing if isinstance(listing, list) else []

    async def _walk_tree(self, root_path: str) -> tuple[dict[str, str], list[dict]]:
        """Walk all subfolders under root_path. Returns:
        - folder_id -> backend-relative dir path (e.g. "/research")
        - flat list of all note rows in the library (caller filters).
        """
        root_id = await self._resolve_folder_id(root_path)
        # BFS through subfolders, caching as we go.
        folder_path_by_id: dict[str, str] = {root_id: root_path.rstrip("/") or ""}
        root_full = self._full_segments(root_path)
        queue: list[tuple[str, tuple[str, ...]]] = [(root_id, root_full)]
        while queue:
            parent_id, parent_full = queue.pop(0)
            children = await self._list_subfolders(parent_id)
            for child in children:
                cid = child.get("id")
                cname = child.get("name")
                if not cid or not cname:
                    continue
                child_full = parent_full + (cname,)
                self._folder_ids[child_full] = cid
                # backend-relative path = strip the memories prefix.
                rel = child_full[len(_AGENT_FOLDER_SEGMENTS):]
                folder_path_by_id[cid] = "/" + "/".join(rel)
                queue.append((cid, child_full))
        notes = await self._list_all_notes()
        return folder_path_by_id, notes

    # -- BackendProtocol async surface (continued) -----------------------

    async def als(self, path: str = "/") -> LsResult:
        await self.bootstrap()
        target_id = await self._resolve_folder_id(path)
        subfolders = await self._list_subfolders(target_id)
        notes = await self._list_all_notes()
        base = path.rstrip("/")  # "" for root
        entries = []
        for f in subfolders:
            entries.append({"path": f"{base}/{f['name']}", "is_dir": True})
        for n in notes:
            if n.get("folderId") == target_id:
                title = n.get("title") or "untitled"
                entries.append({"path": f"{base}/{title}.md", "is_dir": False})
        return LsResult(entries=entries)

    async def aglob(self, pattern: str, path: str = "/") -> GlobResult:
        await self.bootstrap()
        folder_path_by_id, notes = await self._walk_tree(path)
        matches = []
        for n in notes:
            fid = n.get("folderId")
            if fid not in folder_path_by_id:
                continue
            dir_path = folder_path_by_id[fid]
            title = n.get("title") or "untitled"
            note_path = f"{dir_path}/{title}.md" if dir_path else f"/{title}.md"
            # Match pattern against path relative to search root.
            base = path.rstrip("/")
            rel = note_path[len(base):] if base and note_path.startswith(base) else note_path
            rel = rel.lstrip("/")
            if _glob_match(pattern, rel):
                matches.append({"path": note_path, "is_dir": False})
        return GlobResult(matches=matches)

    async def agrep(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
    ) -> GrepResult:
        await self.bootstrap()
        search_root = path or "/"
        glob_result = await self.aglob(glob or "**/*", search_root)
        if glob_result.error:
            return GrepResult(error=glob_result.error)
        try:
            regex = re.compile(pattern)
        except re.error as e:
            return GrepResult(error=f"invalid_pattern: {e}")
        # Map (folderId, title) -> note row for content lookup.
        notes = await self._list_all_notes()
        by_key = {(n.get("folderId"), n.get("title")): n for n in notes}
        # Reverse: backend-rel path -> note row. Reuse the cache plus a fresh walk.
        folder_path_by_id, _ = await self._walk_tree("/")
        path_to_note: dict[str, dict] = {}
        for (fid, title), row in by_key.items():
            if fid in folder_path_by_id and title:
                dir_path = folder_path_by_id[fid]
                p = f"{dir_path}/{title}.md" if dir_path else f"/{title}.md"
                path_to_note[p] = row
        matches: list[dict] = []
        for m in glob_result.matches or []:
            row = path_to_note.get(m["path"])
            if row is None:
                continue
            content = row.get("contentMd") or ""
            for i, line in enumerate(content.splitlines(), start=1):
                if regex.search(line):
                    matches.append({"path": m["path"], "line": i, "text": line})
        return GrepResult(matches=matches)

    async def aupload_files(self, files):
        raise NotImplementedError

    async def adownload_files(self, paths):
        raise NotImplementedError
