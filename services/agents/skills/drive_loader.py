"""Per-user skills loader backed by drive notes under `.episteme/agents/skills/`.

On first call per user (when the drive folder is empty) seeds the defaults
shipped under `services/agents/skills/*/SKILL.md`. Subsequent calls read
straight from the drive, so user edits via the drive UI take effect on the
next agent build.

A fresh `DriveSkillsLoader` instance per agent build is the contract — its
caches (folder ids on the underlying NotesBackend) live for one build only,
which is what makes user edits propagate.
"""
from __future__ import annotations

import logging

from backends import notes_backend as _nb
from backends.notes_backend import NotesBackend

from . import SKILLS_ROOT, SkillSpec, _parse_skill_md_text

logger = logging.getLogger(__name__)

_SKILLS_FOLDER_SEGMENTS: tuple[str, ...] = (".episteme", "agents", "skills")
_SKILL_NOTE_TITLE = "SKILL"


class DriveSkillsLoader:
    """Load `SkillSpec`s from `.episteme/agents/skills/<name>/SKILL` notes."""

    async def load(
        self, only: list[str], *, user_id: str, tolerant: bool = False
    ) -> list[SkillSpec]:
        if not only:
            return []
        backend = NotesBackend(user_id=user_id)
        await backend.bootstrap()
        skills_leaf = await backend.ensure_folder_chain(_SKILLS_FOLDER_SEGMENTS)

        specs = await self._discover_remote(backend, skills_leaf)
        if not specs:
            await self._seed_from_disk(backend, skills_leaf)
            specs = await self._discover_remote(backend, skills_leaf)
        else:
            # One-shot seed-or-update for users who were seeded before a new
            # default skill was added (e.g. deep-read revival in 1.5.1).
            await self._seed_missing_requested_from_disk(
                backend, skills_leaf, requested=set(only), existing=set(specs.keys())
            )
            specs = await self._discover_remote(backend, skills_leaf)

        missing = [n for n in only if n not in specs]
        if missing:
            if tolerant:
                logger.warning(
                    "DriveSkillsLoader: dropping unknown skill(s): %s", missing
                )
                return [specs[n] for n in only if n in specs]
            raise KeyError(f"unknown skill(s): {missing}")
        return [specs[n] for n in only]

    async def _discover_remote(
        self, backend: NotesBackend, skills_leaf: str
    ) -> dict[str, SkillSpec]:
        subfolders = await backend._list_subfolders(skills_leaf)  # noqa: SLF001
        if not subfolders:
            return {}
        notes = await backend._list_all_notes()  # noqa: SLF001
        by_folder: dict[str, list[dict]] = {}
        for n in notes:
            by_folder.setdefault(n.get("folderId"), []).append(n)

        specs: dict[str, SkillSpec] = {}
        for sf in subfolders:
            fid = sf.get("id")
            fname = sf.get("name") or ""
            skill_note = next(
                (n for n in by_folder.get(fid, []) if n.get("title") == _SKILL_NOTE_TITLE),
                None,
            )
            if skill_note is None:
                continue
            virtual_path = SKILLS_ROOT / fname / "SKILL.md"
            spec = _parse_skill_md_text(skill_note.get("contentMd") or "", virtual_path)
            if spec is None:
                continue
            specs[spec.name] = spec
        return specs

    async def _seed_from_disk(self, backend: NotesBackend, skills_leaf: str) -> None:
        if not SKILLS_ROOT.is_dir():
            return
        for child in sorted(SKILLS_ROOT.iterdir()):
            if not child.is_dir() or child.name.startswith(("_", ".")):
                continue
            skill_md = child / "SKILL.md"
            if not skill_md.is_file():
                continue
            folder_id = await backend.ensure_folder_chain(
                _SKILLS_FOLDER_SEGMENTS + (child.name,)
            )
            await _nb.km_post(
                "/api/notes",
                {
                    "libraryId": backend._library_id,  # noqa: SLF001
                    "folderId": folder_id,
                    "title": _SKILL_NOTE_TITLE,
                    "contentMd": skill_md.read_text(encoding="utf-8"),
                },
                user_id=backend.user_id,
            )

    async def _seed_missing_requested_from_disk(
        self,
        backend: NotesBackend,
        skills_leaf: str,
        *,
        requested: set[str],
        existing: set[str],
    ) -> None:
        missing = requested - existing
        if not missing:
            return

        for child in sorted(SKILLS_ROOT.iterdir()):
            if child.name not in missing:
                continue
            if not child.is_dir() or child.name.startswith(("_", ".")):
                continue
            skill_md = child / "SKILL.md"
            if not skill_md.is_file():
                continue
            folder_id = await backend.ensure_folder_chain(
                _SKILLS_FOLDER_SEGMENTS + (child.name,)
            )
            await _nb.km_post(
                "/api/notes",
                {
                    "libraryId": backend._library_id,  # noqa: SLF001
                    "folderId": folder_id,
                    "title": _SKILL_NOTE_TITLE,
                    "contentMd": skill_md.read_text(encoding="utf-8"),
                },
                user_id=backend.user_id,
            )


__all__ = ["DriveSkillsLoader"]
