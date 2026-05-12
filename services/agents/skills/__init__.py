"""Skill loader — discovers SKILL.md files and parses our extended frontmatter.

This loader is independent of the deepagents `SkillsMiddleware` — it parses our
extended frontmatter fields (`tools`, `subagents`, `require_approval`, `read`,
`write`, `model`) that the agent factory uses to filter tool allow-lists,
inject HITL approval rules, and (eventually) scope subagent permissions.

The deepagents skill middleware loads skills separately for system-prompt
advertisement; we pass the SKILLS_ROOT path to `create_deep_agent(skills=...)`
when any skill is enabled.

Canonical frontmatter form (Anthropic Agent Skills spec):
  allowed-tools: tool_a tool_b tool_c   # space-delimited string
  metadata:
    subagents: [verifier]
    require_approval: [update_note]

Legacy form (deprecated, one-release transition):
  tools: [tool_a, tool_b]               # YAML list
  subagents: [verifier]
  require_approval: [update_note]

Body is captured eagerly during parse (single text pass).
"""
from __future__ import annotations

import re
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

SKILLS_ROOT = Path(__file__).resolve().parent

_REQUIRED_BASE = ("name", "description")
_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)


@dataclass
class SkillSpec:
    """A parsed SKILL.md frontmatter spec.

    Body is captured eagerly from the source text during parse and returned
    by `body()`. On disk-backed specs, `body()` falls back to a disk read
    if the cache was not pre-populated (e.g. legacy construction).
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
        """Return the SKILL.md body (everything after closing `---`).

        Pre-populated during parse when text is already in memory. Falls back
        to a disk read if not cached (e.g. SkillSpec built without parse).
        """
        if self._body_cache is None:
            text = self.path.read_text(encoding="utf-8")
            m = _FRONTMATTER_RE.match(text)
            self._body_cache = text[m.end():] if m else text
        return self._body_cache


def _parse_skill_md_text(text: str, path: Path) -> SkillSpec | None:
    """Parse SKILL.md frontmatter from a raw string (canonical + legacy).

    Canonical form uses `allowed-tools` (space-delimited) and nested
    `metadata.subagents` / `metadata.require_approval`. Legacy form uses
    top-level `tools` list, `subagents` list, `require_approval` list —
    still accepted but emits DeprecationWarning.

    Returns None if frontmatter is missing or YAML is invalid. Raises
    ValueError if frontmatter is present but missing required base fields.
    Body text (everything after the closing `---`) is captured eagerly and
    stored in `_body_cache` so `body()` needs no second disk read.
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

    name = data.get("name", path.parent.name)
    missing_base = [k for k in _REQUIRED_BASE if k not in data]
    if missing_base:
        raise ValueError(
            f"SKILL.md at {path} (skill '{name}') missing required fields: {missing_base}"
        )

    def _as_list(v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, list):
            return [str(x) for x in v]
        raise ValueError(f"expected list, got {type(v).__name__}")

    # --- tools: canonical `allowed-tools` string, fallback to legacy `tools` list ---
    if "allowed-tools" in data:
        raw = data["allowed-tools"]
        tools = raw.split() if isinstance(raw, str) else _as_list(raw)
    elif "tools" in data:
        warnings.warn(
            f"SKILL.md at {path} (skill '{name}'): top-level `tools` key is deprecated. "
            "Use `allowed-tools: tool_a tool_b` (space-delimited string). "
            "Legacy support will be removed in the next release.",
            DeprecationWarning,
            stacklevel=2,
        )
        tools = _as_list(data["tools"])
    else:
        raise ValueError(
            f"SKILL.md at {path} (skill '{name}') missing required field: tools or allowed-tools"
        )

    # --- emit DeprecationWarning for any legacy top-level subagents / require_approval ---
    _legacy_top_level = [k for k in ("subagents", "require_approval") if k in data]
    if _legacy_top_level:
        warnings.warn(
            f"SKILL.md at {path} (skill '{name}'): top-level "
            f"{_legacy_top_level} key(s) are deprecated. "
            "Move them under `metadata:` instead. "
            "Legacy support will be removed in the next release.",
            DeprecationWarning,
            stacklevel=2,
        )

    # --- subagents / require_approval: canonical under `metadata`, fallback to top-level ---
    raw_meta = data.get("metadata")
    if raw_meta is not None and not isinstance(raw_meta, dict):
        raise ValueError(
            f"SKILL.md at {path} (skill '{name}'): `metadata` must be a dict, "
            f"got {type(raw_meta).__name__}"
        )
    meta = raw_meta or {}
    if meta:
        subagents = _as_list(meta.get("subagents"))
        require_approval = _as_list(meta.get("require_approval"))
    else:
        if "subagents" not in data and "require_approval" not in data:
            raise ValueError(
                f"SKILL.md at {path} (skill '{name}') missing subagents/require_approval "
                "(expected under `metadata:` or as legacy top-level keys)"
            )
        subagents = _as_list(data.get("subagents"))
        require_approval = _as_list(data.get("require_approval"))

    # Capture body eagerly — no second parse pass needed.
    body_text = text[m.end():]

    return SkillSpec(
        name=str(data["name"]),
        description=str(data["description"]),
        tools=tools,
        subagents=subagents,
        require_approval=require_approval,
        path=path,
        model=str(data["model"]) if data.get("model") else None,
        read=_as_list(data.get("read")),
        write=_as_list(data.get("write")),
        _body_cache=body_text,
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
