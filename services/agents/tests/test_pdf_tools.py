from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

USER = "user_test_1"
CFG = {"configurable": {"user_id": USER}}


@pytest.mark.asyncio
async def test_pdf_read_text_calls_papers_pages_route():
    from tools.pdfs import pdf_read_text

    with patch("tools.pdfs.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"pageNumber": 2, "text": "page two text"}
        out = await pdf_read_text.ainvoke({"paper_id": "p1", "page": 2}, config=CFG)

    assert out == {"pageNumber": 2, "text": "page two text"}
    call = mock_get.await_args
    assert call.args[0] == "/api/papers/p1/pages/2/text"
    assert call.kwargs["user_id"] == USER


@pytest.mark.asyncio
async def test_pdf_read_tables_is_unavailable():
    from tools.pdfs import pdf_read_tables

    out = await pdf_read_tables.ainvoke({"paper_id": "p9", "page": 1}, config=CFG)
    assert out == {"error": True, "status": None, "body": "tool unavailable in this build"}


@pytest.mark.asyncio
async def test_pdf_extract_data_is_unavailable():
    from tools.pdfs import pdf_extract_data

    out = await pdf_extract_data.ainvoke(
        {"paper_id": "p77", "schema": {"type": "object"}}, config=CFG
    )
    assert out == {"error": True, "status": None, "body": "tool unavailable in this build"}


def test_highlight_docstring_has_imperative_language():
    """G3 regression: highlight tool description must tell the model to call the
    tool instead of quoting the passage in prose."""
    from tools.pdfs import highlight

    desc = highlight.description
    assert "Use this tool whenever the user asks to highlight" in desc, (
        f"highlight docstring missing imperative trigger clause: {desc!r}"
    )
    assert "Do NOT respond with the quoted text alone" in desc, (
        f"highlight docstring missing anti-prose instruction: {desc!r}"
    )


def test_deep_read_skill_has_highlight_ordering_example():
    """G3 regression: deep-read SKILL.md must contain a worked read→highlight
    example so the model knows NOT to stop at a prose quote."""
    import pathlib

    skill_path = pathlib.Path(__file__).parent.parent / "skills" / "deep-read" / "SKILL.md"
    text = skill_path.read_text()
    assert "Read-then-highlight ordering" in text, (
        f"deep-read SKILL.md missing read-then-highlight worked example"
    )
    assert "do NOT quote the sentence in prose" in text, (
        f"deep-read SKILL.md missing anti-prose instruction in ordering example"
    )


@pytest.mark.asyncio
async def test_read_paper_schema_array_branches_have_items():
    """Regression: strict OpenAI-style validators (OpenRouter Azure) reject
    `anyOf` array branches missing `items`. PaperScope.range used to be
    `tuple[int, int] | None`, generating `{type: array}` without items."""
    from tools.papers import read_paper

    schema = read_paper.args_schema.model_json_schema() if hasattr(read_paper, "args_schema") and read_paper.args_schema else read_paper.tool_call_schema.model_json_schema()

    def _walk(node, path=""):
        if isinstance(node, dict):
            if node.get("type") == "array" and "items" not in node:
                yield path
            for k, v in node.items():
                yield from _walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                yield from _walk(v, f"{path}[{i}]")

    bad = list(_walk(schema))
    assert not bad, f"array schemas missing 'items' at: {bad}"
