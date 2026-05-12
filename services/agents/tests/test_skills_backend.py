"""Tests for SkillsBackend — read-only on-disk skills directory."""
import pytest


def _make_backend():
    from backends.skills_backend import SkillsBackend  # noqa: PLC0415
    return SkillsBackend()


@pytest.mark.asyncio
async def test_als_lists_skill_dirs():
    backend = _make_backend()
    result = await backend.als("/.episteme/agents/skills/")
    entries = result.entries
    assert entries is not None
    names = {e["path"].rstrip("/").rsplit("/", 1)[-1] for e in entries}
    expected = {"data-extract", "claim-verify", "deep-read", "lit-triage", "paper-search", "synthesis"}
    assert expected.issubset(names), f"Missing skills: {expected - names}"
    assert all(e["is_dir"] for e in entries), "All entries should be directories"
    assert "_deep-read" not in names, "_deep-read should be excluded"


@pytest.mark.asyncio
async def test_aread_returns_skill_body():
    backend = _make_backend()
    result = await backend.aread("/.episteme/agents/skills/data-extract/SKILL.md")
    assert result.error is None
    content_str = result.file_data["content"]
    assert content_str.startswith("---"), "First line should be ---"
    assert "name: data-extract" in content_str
    assert "Call `read_paper(paper_id, scope)`" in content_str


@pytest.mark.asyncio
async def test_writes_rejected():
    backend = _make_backend()
    with pytest.raises(PermissionError):
        await backend.awrite("/.episteme/agents/skills/x/SKILL.md", "x")


@pytest.mark.asyncio
async def test_path_traversal_rejected():
    """A virtual path with .. segments must not escape _DISK_ROOT."""
    backend = _make_backend()
    with pytest.raises(PermissionError, match="outside skills root"):
        await backend.aread("/.episteme/agents/skills/../../../etc/passwd")


@pytest.mark.asyncio
async def test_read_respects_limit():
    """aread with limit=1 must return at most 1 line of content."""
    backend = _make_backend()
    result = await backend.aread("/.episteme/agents/skills/data-extract/SKILL.md", limit=1)
    assert result.error is None
    content = result.file_data["content"]
    assert "\n" not in content, f"Expected 1 line, got multiple: {content!r}"


@pytest.mark.asyncio
async def test_read_respects_offset():
    """aread with offset=N must skip the first N lines."""
    backend = _make_backend()
    # Read full file first to know what line N looks like
    full = await backend.aread("/.episteme/agents/skills/data-extract/SKILL.md")
    all_lines = full.file_data["content"].splitlines()
    offset = 2
    result = await backend.aread("/.episteme/agents/skills/data-extract/SKILL.md", offset=offset)
    assert result.error is None
    result_lines = result.file_data["content"].splitlines()
    assert result_lines[0] == all_lines[offset], (
        f"First line at offset={offset} should be {all_lines[offset]!r}, got {result_lines[0]!r}"
    )
