"""Tests for skills.load_skills — frontmatter parser + lazy body load."""
from pathlib import Path

import pytest


def _write_skill(root: Path, name: str, frontmatter: str, body: str = "Body content") -> Path:
    skill_dir = root / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    p = skill_dir / "SKILL.md"
    p.write_text(f"---\n{frontmatter}\n---\n\n{body}\n")
    return p


def test_load_skills_empty_only_returns_empty(tmp_path, monkeypatch):
    from skills import load_skills  # noqa: PLC0415

    monkeypatch.setattr("skills.SKILLS_ROOT", tmp_path)
    assert load_skills(only=[]) == []


def test_load_skills_parses_full_frontmatter(tmp_path, monkeypatch):
    _write_skill(
        tmp_path,
        "lit-triage",
        "name: lit-triage\n"
        "description: Triage daily literature\n"
        "tools: [search_notes, create_note]\n"
        "subagents: [researcher]\n"
        "require_approval: [create_note]\n",
        body="# Lit Triage\n\nDo the thing.",
    )
    from skills import load_skills  # noqa: PLC0415

    monkeypatch.setattr("skills.SKILLS_ROOT", tmp_path)
    specs = load_skills(only=["lit-triage"])
    assert len(specs) == 1
    s = specs[0]
    assert s.name == "lit-triage"
    assert s.description == "Triage daily literature"
    assert s.tools == ["search_notes", "create_note"]
    assert s.subagents == ["researcher"]
    assert s.require_approval == ["create_note"]
    assert s.model is None
    assert s.read == []
    assert s.write == []


def test_load_skills_parses_optional_fields(tmp_path, monkeypatch):
    _write_skill(
        tmp_path,
        "deep-read",
        "name: deep-read\n"
        "description: Deep PDF read\n"
        "tools: [extract_passages, highlight]\n"
        "subagents: []\n"
        "require_approval: [highlight]\n"
        "model: anthropic:claude-opus-4\n"
        "read: [/pdfs/]\n"
        "write: [/scratch/, /memories/]\n",
    )
    from skills import load_skills  # noqa: PLC0415

    monkeypatch.setattr("skills.SKILLS_ROOT", tmp_path)
    [s] = load_skills(only=["deep-read"])
    assert s.model == "anthropic:claude-opus-4"
    assert s.read == ["/pdfs/"]
    assert s.write == ["/scratch/", "/memories/"]


def test_load_skills_filters_by_only(tmp_path, monkeypatch):
    _write_skill(
        tmp_path, "a",
        "name: a\ndescription: A\ntools: []\nsubagents: []\nrequire_approval: []\n",
    )
    _write_skill(
        tmp_path, "b",
        "name: b\ndescription: B\ntools: []\nsubagents: []\nrequire_approval: []\n",
    )
    from skills import load_skills  # noqa: PLC0415

    monkeypatch.setattr("skills.SKILLS_ROOT", tmp_path)
    specs = load_skills(only=["a"])
    assert [s.name for s in specs] == ["a"]


def test_load_skills_unknown_name_raises_keyerror(tmp_path, monkeypatch):
    _write_skill(
        tmp_path, "a",
        "name: a\ndescription: A\ntools: []\nsubagents: []\nrequire_approval: []\n",
    )
    from skills import load_skills  # noqa: PLC0415

    monkeypatch.setattr("skills.SKILLS_ROOT", tmp_path)
    with pytest.raises(KeyError):
        load_skills(only=["nonexistent"])


def test_load_skills_rejects_malformed_frontmatter(tmp_path, monkeypatch):
    skill_dir = tmp_path / "broken"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("no frontmatter here\n")
    from skills import load_skills  # noqa: PLC0415

    monkeypatch.setattr("skills.SKILLS_ROOT", tmp_path)
    # Unknown skill since the malformed file is silently skipped (not in registry).
    with pytest.raises(KeyError):
        load_skills(only=["broken"])


def test_load_skills_missing_required_field_raises(tmp_path, monkeypatch):
    skill_dir = tmp_path / "bad"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(
        "---\nname: bad\ndescription: missing tools field\n---\n\nbody\n"
    )
    from skills import load_skills  # noqa: PLC0415

    monkeypatch.setattr("skills.SKILLS_ROOT", tmp_path)
    with pytest.raises(ValueError, match="bad"):
        load_skills(only=["bad"])


def test_load_skills_lazy_body_load(tmp_path, monkeypatch):
    """Body must NOT be slurped during load_skills(); only on body() call.

    We prove laziness by counting Path.read_text invocations: load_skills()
    reads exactly once (frontmatter parse), body() adds one more read, and
    the second body() call is a cache hit (no new read).
    """
    p = _write_skill(
        tmp_path,
        "lazy",
        "name: lazy\ndescription: Lazy\ntools: []\nsubagents: []\nrequire_approval: []\n",
        body="# Lazy body\n\nSecret instructions here.",
    )
    from skills import load_skills  # noqa: PLC0415

    monkeypatch.setattr("skills.SKILLS_ROOT", tmp_path)

    # Spy on Path.read_text — count invocations against our SKILL.md path.
    real_read_text = Path.read_text
    counter = {"n": 0}

    def counting_read_text(self, *args, **kwargs):
        if self == p:
            counter["n"] += 1
        return real_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", counting_read_text)

    [s] = load_skills(only=["lazy"])
    assert s.path == p
    # Frontmatter parse reads the file exactly once.
    assert counter["n"] == 1, f"expected 1 read after load_skills, got {counter['n']}"

    body = s.body()
    assert "Lazy body" in body
    assert "Secret instructions" in body
    # Frontmatter should not be in body
    assert "name: lazy" not in body
    # First body() call triggers a read.
    assert counter["n"] == 2, f"expected 2 reads after first body(), got {counter['n']}"

    # Second body() call must be a cache hit — no new read.
    body2 = s.body()
    assert body2 == body
    assert counter["n"] == 2, f"expected cached body(), got {counter['n']} reads"


def test_load_skills_skips_non_skill_dirs(tmp_path, monkeypatch):
    (tmp_path / "__pycache__").mkdir()
    (tmp_path / "__pycache__" / "junk.pyc").write_text("")
    _write_skill(
        tmp_path, "real",
        "name: real\ndescription: R\ntools: []\nsubagents: []\nrequire_approval: []\n",
    )
    from skills import load_skills  # noqa: PLC0415

    monkeypatch.setattr("skills.SKILLS_ROOT", tmp_path)
    [s] = load_skills(only=["real"])
    assert s.name == "real"
