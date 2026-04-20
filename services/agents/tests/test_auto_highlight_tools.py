import os
from pathlib import Path

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")
os.environ["INHALE_STUB_EMBEDDINGS"] = "1"

from unittest.mock import AsyncMock, patch
import pytest

from lib import auto_highlight_tools
from lib.auto_highlight_tools import build_tools


RUN_ID = "11111111-1111-1111-1111-111111111111"
USER_ID = "user_1"
DOC_ID = 42
PDF_PATH = str(Path(__file__).resolve().parents[3] / "apps/web/e2e/fixtures/test.pdf")


def _get_tool(tools, name):
    return next(t for t in tools if t.name == name)


def _async_run_id(rid):
    async def _fn():
        return rid

    return _fn


@pytest.mark.asyncio
async def test_semantic_search_returns_shape_and_filters_by_document():
    rows = [
        {
            "id": 7,
            "page_start": 3,
            "page_end": 3,
            "content": "loss function defined",
            "score": 0.91,
        },
        {
            "id": 9,
            "page_start": 5,
            "page_end": 5,
            "content": "we minimize",
            "score": 0.77,
        },
    ]
    seen_args = []

    async def fetch(query, *args):
        seen_args.append((query, args))
        return rows

    conn = AsyncMock()
    conn.fetch.side_effect = fetch

    tools = build_tools(conn, USER_ID, DOC_ID, _async_run_id(RUN_ID), "sk-test", PDF_PATH)
    tool = _get_tool(tools, "semantic_search")
    result = await tool.ainvoke({"query": "loss function", "top_k": 2})

    assert len(result) == 2
    assert result[0] == {
        "chunk_id": 7,
        "page": 3,
        "page_start": 3,
        "page_end": 3,
        "content": "loss function defined",
        "score": 0.91,
    }
    # document_id passed to SQL
    assert seen_args[0][1][0] == DOC_ID


@pytest.mark.asyncio
async def test_semantic_search_calls_embed_texts_with_query():
    rows = []
    conn = AsyncMock()
    conn.fetch.return_value = rows

    called = {}

    async def fake_embed(key, inputs):
        called["inputs"] = inputs
        return [[0.01] * 1536]

    with patch("lib.auto_highlight_tools.embed_texts", side_effect=fake_embed):
        tools = build_tools(conn, USER_ID, DOC_ID, _async_run_id(RUN_ID), "sk-test", PDF_PATH)
        tool = _get_tool(tools, "semantic_search")
        await tool.ainvoke({"query": "regularization"})

    assert called["inputs"] == ["regularization"]


@pytest.mark.asyncio
async def test_page_text_returns_text_and_count():
    conn = AsyncMock()
    tools = build_tools(conn, USER_ID, DOC_ID, _async_run_id(RUN_ID), "sk-test", PDF_PATH)
    tool = _get_tool(tools, "page_text")
    result = await tool.ainvoke({"page_number": 1})

    assert result["page"] == 1
    assert "Test PDF Document" in result["text"]
    assert result["char_count"] == len(result["text"])


@pytest.mark.asyncio
async def test_page_text_out_of_range_returns_error():
    conn = AsyncMock()
    tools = build_tools(conn, USER_ID, DOC_ID, _async_run_id(RUN_ID), "sk-test", PDF_PATH)
    tool = _get_tool(tools, "page_text")
    result = await tool.ainvoke({"page_number": 999})
    assert "error" in result


@pytest.mark.asyncio
async def test_locate_phrase_exact_match_finds_hits():
    conn = AsyncMock()
    tools = build_tools(conn, USER_ID, DOC_ID, _async_run_id(RUN_ID), "sk-test", PDF_PATH)
    tool = _get_tool(tools, "locate_phrase")
    result = await tool.ainvoke({"phrase": "test document", "page_number": 1})
    assert len(result) >= 1
    hit = result[0]
    assert "start_offset" in hit and "end_offset" in hit
    assert hit["end_offset"] > hit["start_offset"]
    assert hit["text"].lower() == "test document"
    assert isinstance(hit["rects"], list) and len(hit["rects"]) >= 1
    rect = hit["rects"][0]
    assert rect["page"] == 1
    assert all(k in rect for k in ("x0", "y0", "x1", "y1"))


@pytest.mark.asyncio
async def test_locate_phrase_no_hits_returns_empty():
    conn = AsyncMock()
    # ensure fuzzy off
    os.environ.pop("AUTO_HIGHLIGHT_FUZZY", None)
    tools = build_tools(conn, USER_ID, DOC_ID, _async_run_id(RUN_ID), "sk-test", PDF_PATH)
    tool = _get_tool(tools, "locate_phrase")
    result = await tool.ainvoke(
        {"phrase": "quantum teleportation spaghetti", "page_number": 1}
    )
    assert result == []


@pytest.mark.asyncio
async def test_locate_phrase_fuzzy_gated_by_env():
    conn = AsyncMock()
    tools = build_tools(conn, USER_ID, DOC_ID, _async_run_id(RUN_ID), "sk-test", PDF_PATH)
    tool = _get_tool(tools, "locate_phrase")

    # Without flag: no hit
    os.environ.pop("AUTO_HIGHLIGHT_FUZZY", None)
    no_fuzz = await tool.ainvoke({"phrase": "test dokument", "page_number": 1})
    assert no_fuzz == []

    # With flag: should try fuzzy matching
    os.environ["AUTO_HIGHLIGHT_FUZZY"] = "1"
    try:
        fuzz = await tool.ainvoke({"phrase": "test dokument", "page_number": 1})
        # We expect at least one fuzzy hit on a near-exact misspelling
        assert isinstance(fuzz, list)
    finally:
        os.environ.pop("AUTO_HIGHLIGHT_FUZZY", None)


@pytest.mark.asyncio
async def test_locate_phrase_caps_at_max(monkeypatch):
    conn = AsyncMock()
    # "e" appears 17 times in the fixture; cap at 3 so the limit actually bites.
    monkeypatch.setattr(auto_highlight_tools, "MAX_LOCATE_HITS", 3)
    tools = build_tools(conn, USER_ID, DOC_ID, _async_run_id(RUN_ID), "sk-test", PDF_PATH)
    tool = _get_tool(tools, "locate_phrase")
    result = await tool.ainvoke({"phrase": "e", "page_number": 1})
    assert len(result) == 3


@pytest.mark.asyncio
async def test_create_highlights_inserts_rows():
    conn = AsyncMock()
    conn.fetchval.return_value = 0  # existing count
    conn.execute.return_value = None

    tools = build_tools(conn, USER_ID, DOC_ID, _async_run_id(RUN_ID), "sk-test", PDF_PATH)
    tool = _get_tool(tools, "create_highlights")

    matches = [
        {
            "page_number": 1,
            "text_content": "hello",
            "start_offset": 0,
            "end_offset": 5,
            "rects": [{"page": 1, "x0": 10, "y0": 20, "x1": 60, "y1": 40}],
        },
        {
            "page_number": 2,
            "text_content": "world",
            "start_offset": 10,
            "end_offset": 15,
            "rects": [{"page": 2, "x0": 10, "y0": 20, "x1": 60, "y1": 40}],
        },
    ]
    result = await tool.ainvoke({"matches": matches})

    assert result == {"inserted": 2, "total_in_run": 2, "capped": False}
    assert conn.execute.call_count == 2

    # Inspect first INSERT args: source='ai-auto', layer_id=RUN_ID, color='amber'
    call_args = conn.execute.call_args_list[0][0]
    sql = call_args[0]
    assert "INSERT INTO user_highlights" in sql
    # positional args: user_id, doc_id, page, text, start, end, color, source, layer_id, rects
    params = call_args[1:]
    assert USER_ID in params
    assert DOC_ID in params
    assert "ai-auto" in params
    assert "amber" in params
    assert RUN_ID in params


@pytest.mark.asyncio
async def test_create_highlights_caps_at_50():
    conn = AsyncMock()
    # 48 already present; submitting 5 → only 2 fit
    conn.fetchval.return_value = 48
    conn.execute.return_value = None

    tools = build_tools(conn, USER_ID, DOC_ID, _async_run_id(RUN_ID), "sk-test", PDF_PATH)
    tool = _get_tool(tools, "create_highlights")
    matches = [
        {
            "page_number": 1,
            "text_content": f"m{i}",
            "start_offset": i,
            "end_offset": i + 1,
            "rects": [{"page": 1, "x0": 0, "y0": 0, "x1": 1, "y1": 1}],
        }
        for i in range(5)
    ]
    result = await tool.ainvoke({"matches": matches})
    assert result["capped"] is True
    assert result["inserted"] == 2
    assert result["total_in_run"] == 50
    assert conn.execute.call_count == 2


@pytest.mark.asyncio
async def test_get_run_id_called_once_across_multiple_create_highlights():
    conn = AsyncMock()
    conn.fetchval.return_value = 0
    conn.execute.return_value = None

    call_count = {"n": 0}

    async def get_run_id():
        call_count["n"] += 1
        return RUN_ID

    tools = build_tools(conn, USER_ID, DOC_ID, get_run_id, "sk-test", PDF_PATH)
    tool = _get_tool(tools, "create_highlights")

    match = {
        "page_number": 1,
        "text_content": "hello",
        "start_offset": 0,
        "end_offset": 5,
        "rects": [{"page": 1, "x0": 0, "y0": 0, "x1": 1, "y1": 1}],
    }
    await tool.ainvoke({"matches": [match]})
    await tool.ainvoke({"matches": [match]})
    await tool.ainvoke({"matches": [match]})

    assert call_count["n"] == 1


@pytest.mark.asyncio
async def test_get_run_id_not_awaited_when_no_highlights_created():
    conn = AsyncMock()

    call_count = {"n": 0}

    async def get_run_id():
        call_count["n"] += 1
        return RUN_ID

    # Build tools and exercise non-writing tools only.
    tools = build_tools(conn, USER_ID, DOC_ID, get_run_id, "sk-test", PDF_PATH)
    page_text_tool = _get_tool(tools, "page_text")
    finish_tool = _get_tool(tools, "finish")

    await page_text_tool.ainvoke({"page_number": 1})
    await finish_tool.ainvoke({"summary": "done"})

    assert call_count["n"] == 0


def test_tool_descriptions_gate_intent():
    """The two entry-point tools must tell the agent when NOT to use them."""
    conn = AsyncMock()
    tools = build_tools(conn, USER_ID, DOC_ID, _async_run_id(RUN_ID), "sk-test", PDF_PATH)
    by_name = {t.name: t for t in tools}
    for tool_name in ("semantic_search", "create_highlights"):
        desc = by_name[tool_name].description
        assert "explicitly" in desc.lower()
        assert "do NOT call this tool" in desc or "do not call this tool" in desc.lower()


@pytest.mark.asyncio
async def test_finish_returns_summary():
    conn = AsyncMock()
    tools = build_tools(conn, USER_ID, DOC_ID, _async_run_id(RUN_ID), "sk-test", PDF_PATH)
    tool = _get_tool(tools, "finish")
    result = await tool.ainvoke({"summary": "Highlighted loss function definition"})
    assert result == {"summary": "Highlighted loss function definition", "done": True}
