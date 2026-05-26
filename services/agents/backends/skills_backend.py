"""SkillsBackend — read-only view of on-disk skills/ directory plus virtual
in-memory personal skills.

Implements the subset of BackendProtocol needed by SkillsMiddleware._alist_skills
and FilesystemMiddleware.read_file:
  - ls(path)             → LsResult with skill dir entries (is_dir=True)
  - download_files(paths)→ batch SKILL.md bytes
  - read(path)           → single-file ReadResult
  - write(...)           → always PermissionError (read-only)

Two skill sources are merged at the virtual root /.episteme/agents/skills/:
  - on-disk skills under services/agents/skills/ (canonical built-in skills)
  - personal_skills (in-memory list[dict]) supplied by the caller — these are
    user-authored skills fetched from /api/agents/skills/personal and
    surfaced as first-class SkillSpecs via SkillsMiddleware (progressive
    disclosure: only name + description in the prompt; body loaded on demand).
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable, Mapping

from deepagents.backends.protocol import (
    BackendProtocol,
    FileData,
    FileDownloadResponse,
    FileInfo,
    GlobResult,
    LsResult,
    ReadResult,
    WriteResult,
)

_VIRTUAL_ROOT = "/.episteme/agents/skills"
_DISK_ROOT = Path(__file__).resolve().parent.parent / "skills"


def _glob_match(pattern: str, path: str) -> bool:
    """Match ``path`` against a glob ``pattern`` with ``**`` recursive support.

    Mirrors ``NotesBackend._glob_match`` so the two route-mounted backends use
    a single, consistent glob dialect. Translates:

    * ``**`` → any chars (including ``/``); ``**/`` → zero-or-more path segments
    * ``*``  → any non-slash chars
    * ``?``  → single non-slash char
    * ``[...]`` / ``[!...]`` → fnmatch character class (``!`` → ``^``)
    * everything else → regex-escaped literal
    """
    i = 0
    out = ["(?s:"]
    n = len(pattern)
    while i < n:
        c = pattern[i]
        if c == "*":
            if i + 1 < n and pattern[i + 1] == "*":
                if i + 2 < n and pattern[i + 2] == "/":
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
        elif c == "[":
            # fnmatch-style character class. Find the matching ].
            j = i + 1
            if j < n and pattern[j] == "!":
                j += 1
            if j < n and pattern[j] == "]":
                # First char after `[` (or after `[!`) is a literal `]`.
                j += 1
            while j < n and pattern[j] != "]":
                j += 1
            if j >= n:
                # No closing bracket — treat `[` as literal.
                out.append("\\[")
                i += 1
                continue
            cls = pattern[i + 1 : j]
            if cls.startswith("!"):
                cls = "^" + cls[1:]
            # Backslashes inside a class are literal in fnmatch; escape them
            # so the regex engine doesn't interpret them.
            cls = cls.replace("\\", "\\\\")
            out.append("[" + cls + "]")
            i = j + 1
        else:
            out.append(re.escape(c) if not c.isalnum() and c not in "/-_" else c)
            i += 1
    out.append(")\\Z")
    return re.match("".join(out), path) is not None


def _virtual_to_disk(virtual_path: str) -> Path:
    relative = virtual_path.removeprefix(_VIRTUAL_ROOT).lstrip("/")
    candidate = (_DISK_ROOT / relative).resolve()
    if not candidate.is_relative_to(_DISK_ROOT):
        raise PermissionError(
            f"Path traversal detected: {virtual_path!r} resolves outside skills root"
        )
    return candidate


def _personal_skill_md(skill: Mapping[str, object]) -> str:
    """Render a personal skill dict as a SKILL.md file with valid frontmatter.

    SkillsMiddleware._parse_skill_metadata requires `name` and `description`
    in the YAML frontmatter and the parent directory name must match `name`.
    """
    slug = str(skill.get("slug") or skill.get("name") or "personal").strip()
    description = str(skill.get("description") or "").strip() or slug
    instructions = str(skill.get("instructions") or "").strip()
    display_name = str(skill.get("name") or slug)
    # Frontmatter description must be single-line; collapse newlines.
    desc_oneline = " ".join(description.split())
    body = instructions or "(no instructions provided)"
    return (
        f"---\nname: {slug}\ndescription: {desc_oneline}\n---\n\n"
        f"# {display_name}\n\n{body}\n"
    )


class SkillsBackend(BackendProtocol):
    """Read-only backend serving on-disk skills + in-memory personal skills.

    Args:
        enabled: When a non-None frozenset, restricts on-disk ``ls`` entries to
            those names. ``None`` means advertise all on-disk skills. Personal
            skills are unaffected by this filter — if you don't want them, pass
            ``personal_skills=None``.
        personal_skills: Optional iterable of personal-skill dicts (``slug``,
            ``name``, ``description``, ``instructions``). Each is exposed as a
            virtual subdir ``<slug>/SKILL.md`` under the skills root.
    """

    def __init__(
        self,
        enabled: frozenset[str] | None = None,
        *,
        personal_skills: Iterable[Mapping[str, object]] | None = None,
    ) -> None:
        self._enabled = enabled
        self._personal: dict[str, str] = {}
        for skill in personal_skills or []:
            slug = str(skill.get("slug") or skill.get("name") or "").strip()
            if not slug:
                continue
            self._personal[slug] = _personal_skill_md(skill)

    # ------------------------------------------------------------------ ls
    def ls(self, path: str) -> LsResult:
        disk_dir = _virtual_to_disk(path)
        normalized = path.rstrip("/")
        # At-root when called directly (full virtual path) OR via CompositeBackend
        # (which strips the route prefix and passes "/").
        at_root = normalized in ("", _VIRTUAL_ROOT)
        entries: list[FileInfo] = []

        # On-disk subdirs (filtered by allow-list).
        if disk_dir.is_dir():
            for child in sorted(disk_dir.iterdir()):
                if not child.is_dir() or child.name.startswith("_"):
                    continue
                if self._enabled is not None and child.name not in self._enabled:
                    continue
                virtual_child = normalized + "/" + child.name + "/"
                entries.append(FileInfo(path=virtual_child, is_dir=True))

        if at_root:
            on_disk_names = {e["path"].rstrip("/").rsplit("/", 1)[-1] for e in entries}
            for slug in sorted(self._personal):
                if slug in on_disk_names:
                    continue
                entries.append(
                    FileInfo(path=f"{normalized}/{slug}/", is_dir=True)
                )

        if not entries and not disk_dir.is_dir():
            return LsResult(error=f"not a directory: {path}")
        return LsResult(entries=entries)

    # ---------------------------------------------------------------- read
    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        personal_body = self._maybe_personal_body(file_path)
        if personal_body is not None:
            lines = personal_body.splitlines()
            selected = lines[offset : offset + limit]
            return ReadResult(
                file_data=FileData(content="\n".join(selected), encoding="utf-8")
            )

        disk_path = _virtual_to_disk(file_path)
        if not disk_path.is_file():
            return ReadResult(error="file_not_found")
        content = disk_path.read_text(encoding="utf-8")
        lines = content.splitlines()
        selected = lines[offset : offset + limit]
        return ReadResult(file_data=FileData(content="\n".join(selected), encoding="utf-8"))

    # ------------------------------------------------------ download_files
    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        results: list[FileDownloadResponse] = []
        for path in paths:
            personal_body = self._maybe_personal_body(path)
            if personal_body is not None:
                results.append(
                    FileDownloadResponse(path=path, content=personal_body.encode("utf-8"))
                )
                continue
            disk_path = _virtual_to_disk(path)
            if not disk_path.is_file():
                results.append(FileDownloadResponse(path=path, error="file_not_found"))
            else:
                results.append(FileDownloadResponse(path=path, content=disk_path.read_bytes()))
        return results

    # ---------------------------------------------------------------- glob
    def glob(self, pattern: str, path: str = "/") -> GlobResult:
        """Enumerate SKILL.md virtual paths matching ``pattern``.

        Implements the ``BackendProtocol.glob`` contract so the deepagents
        ``glob`` tool (which flows through ``CompositeBackend.aglob`` and the
        base ``aglob`` default that delegates to ``glob`` via to_thread) does
        not raise ``NotImplementedError`` and kill the LangGraph stream.

        Reports paths relative to the backend's virtual root — CompositeBackend
        re-prefixes them with the mount point on the way back to the agent.
        """
        rel_pattern = pattern.lstrip("/")
        # Codex follow-up: callers may pass the full virtual root
        # (`/.episteme/agents/skills` or `/.episteme/agents/skills/<slug>`) as
        # `path`. Strip it so the per-candidate prefix check below operates on
        # the same root-relative form that we generate for `candidates`. Mirrors
        # `_maybe_personal_body`'s acceptance of both forms.
        if path.startswith(_VIRTUAL_ROOT):
            path = path[len(_VIRTUAL_ROOT):] or "/"
        candidates: list[str] = []

        # On-disk skills (respect allow-list).
        if _DISK_ROOT.is_dir():
            for skill_dir in sorted(_DISK_ROOT.iterdir()):
                if not skill_dir.is_dir() or skill_dir.name.startswith("_"):
                    continue
                if self._enabled is not None and skill_dir.name not in self._enabled:
                    continue
                for file_path in skill_dir.rglob("*"):
                    if not file_path.is_file():
                        continue
                    rel = file_path.relative_to(_DISK_ROOT).as_posix()
                    candidates.append("/" + rel)

        # Personal skills — each slug owns a single virtual SKILL.md.
        for slug in self._personal:
            candidates.append(f"/{slug}/SKILL.md")

        base = path.rstrip("/")
        matches: list[FileInfo] = []
        seen: set[str] = set()
        for cand in candidates:
            if base and not cand.startswith(base + "/") and cand != base:
                continue
            rel = cand[len(base):].lstrip("/") if base else cand.lstrip("/")
            if _glob_match(rel_pattern, rel) and cand not in seen:
                seen.add(cand)
                matches.append(FileInfo(path=cand, is_dir=False))
        matches.sort(key=lambda fi: fi["path"])
        return GlobResult(matches=matches)

    # --------------------------------------------------------------- write
    def write(self, file_path: str, content: str) -> WriteResult:
        raise PermissionError("SkillsBackend is read-only")

    # ----------------------------------------------------------- internals
    def _maybe_personal_body(self, virtual_path: str) -> str | None:
        """Return the personal-skill SKILL.md body if ``virtual_path`` matches one.

        Accepts both the full virtual form (``/.episteme/agents/skills/<slug>/SKILL.md``)
        and the CompositeBackend-stripped form (``/<slug>/SKILL.md``).
        """
        prefix = _VIRTUAL_ROOT + "/"
        if virtual_path.startswith(prefix):
            tail = virtual_path[len(prefix):]
        elif virtual_path.startswith("/"):
            tail = virtual_path[1:]
        else:
            return None
        parts = tail.split("/")
        if len(parts) != 2 or parts[1] != "SKILL.md":
            return None
        return self._personal.get(parts[0])
