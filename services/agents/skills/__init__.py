"""Skill loader — discovers SKILL.md files and parses our extended frontmatter.

This loader is independent of the deepagents `SkillsMiddleware` — it parses our
extended frontmatter fields (`tools`, `subagents`, `require_approval`, `read`,
`write`, `model`) that the agent factory uses to filter tool allow-lists,
inject HITL approval rules, and (eventually) scope subagent permissions.

The deepagents skill middleware loads skills separately for system-prompt
advertisement; we pass the SKILLS_ROOT path to `create_deep_agent(skills=...)`
when any skill is enabled.

Progressive disclosure: `SkillSpec.body()` reads the markdown body lazily.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

SKILLS_ROOT = Path(__file__).resolve().parent

_REQUIRED = ("name", "description", "tools", "subagents", "require_approval")
_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)


@dataclass
class SkillSpec:
    """A parsed SKILL.md frontmatter spec.

    Body content is loaded lazily via `body()` (progressive disclosure).
    """

    name: str
    description: str
    tools: list[str]
    subagents: list[str]
    require_approval: list[str]
    path: Path
    model: str | None = None
    read: list[str] = field(default_factory=list)
    write: list[str] = field(default_factory=list)
    _body_cache: str | None = field(default=None, repr=False)

    def body(self) -> str:
        """Read + cache the SKILL.md body (everything after closing `---`)."""
        if self._body_cache is None:
            text = self.path.read_text(encoding="utf-8")
            m = _FRONTMATTER_RE.match(text)
            self._body_cache = text[m.end():] if m else text
        return self._body_cache


def _parse_skill_md_text(text: str, path: Path) -> SkillSpec | None:
    """Parse SKILL.md frontmatter from a raw string.

    Returns None if frontmatter missing/invalid YAML. Raises ValueError if
    frontmatter is present but missing required fields. The `path` parameter
    is used for SkillSpec.path attribute and for error messages.
    """
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return None
    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        return None
    if not isinstance(data, dict):
        return None

    missing = [k for k in _REQUIRED if k not in data]
    name = data.get("name", path.parent.name)
    if missing:
        raise ValueError(
            f"SKILL.md at {path} (skill '{name}') missing required fields: {missing}"
        )

    def _as_list(v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, list):
            return [str(x) for x in v]
        raise ValueError(f"expected list, got {type(v).__name__}")

    return SkillSpec(
        name=str(data["name"]),
        description=str(data["description"]),
        tools=_as_list(data["tools"]),
        subagents=_as_list(data["subagents"]),
        require_approval=_as_list(data["require_approval"]),
        path=path,
        model=str(data["model"]) if data.get("model") else None,
        read=_as_list(data.get("read")),
        write=_as_list(data.get("write")),
    )


def _parse_skill_md(path: Path) -> SkillSpec | None:
    """Parse a SKILL.md file. Thin wrapper around `_parse_skill_md_text`."""
    return _parse_skill_md_text(path.read_text(encoding="utf-8"), path)


def _discover() -> dict[str, SkillSpec]:
    """Walk SKILLS_ROOT for `*/SKILL.md` files. Returns {name: SkillSpec}.

    Skips directories that don't contain a parseable SKILL.md (e.g. __pycache__).
    Raises ValueError for SKILL.md files with frontmatter but invalid required fields.
    """
    registry: dict[str, SkillSpec] = {}
    if not SKILLS_ROOT.is_dir():
        return registry
    for child in sorted(SKILLS_ROOT.iterdir()):
        if not child.is_dir() or child.name.startswith(("_", ".")):
            continue
        skill_md = child / "SKILL.md"
        if not skill_md.is_file():
            continue
        spec = _parse_skill_md(skill_md)
        if spec is None:
            continue
        registry[spec.name] = spec
    return registry


def load_skills(only: list[str]) -> list[SkillSpec]:
    """Load skill specs whose `name` is in `only`.

    Empty `only` returns []. Unknown names in `only` raise KeyError.
    Lazy body load — body() not called here.
    """
    if not only:
        return []
    registry = _discover()
    missing = [n for n in only if n not in registry]
    if missing:
        raise KeyError(f"unknown skill(s): {missing}")
    return [registry[n] for n in only]


__all__ = ["SkillSpec", "SKILLS_ROOT", "load_skills"]
