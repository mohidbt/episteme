"""RED tests for services/agents/tools/ — LangChain @tool registry."""
import os
from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.tools import BaseTool

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")

USER = "user_test_1"

# `user_id` is now injected via RunnableConfig.configurable (see §1.3b-E2E-3),
# never accepted as a tool arg. This is the per-invoke config every test uses.
CFG = {"configurable": {"user_id": USER}}

# ---------------------------------------------------------------------------
# ALL_TOOLS aggregator
# ---------------------------------------------------------------------------


def test_all_tools_count():
    from tools import ALL_TOOLS  # noqa: PLC0415

    assert len(ALL_TOOLS) == 17, f"Expected 17, got {len(ALL_TOOLS)}"


def test_all_tools_are_base_tool():
    from tools import ALL_TOOLS  # noqa: PLC0415

    for t in ALL_TOOLS:
        assert isinstance(t, BaseTool), f"{t!r} is not a BaseTool"


def test_all_tools_names_unique():
    from tools import ALL_TOOLS  # noqa: PLC0415

    names = [t.name for t in ALL_TOOLS]
    assert len(names) == len(set(names)), f"Duplicate tool names: {names}"


def test_all_tools_contains_expected_names():
    from tools import ALL_TOOLS  # noqa: PLC0415

    expected = {
        "list_notes",
        "search_notes",
        "read_note",
        "create_note",
        "update_note",
        "list_links",
        "list_backlinks",
        "list_pdfs",
        "extract_passages",
        "highlight",
        "get_page_text",
        "list_references",
        "get_reference",
        "diff_revision",
        "week_summary",
        "activity",
        "make_public",
    }
    actual = {t.name for t in ALL_TOOLS}
    assert actual == expected, f"Missing: {expected - actual}, Extra: {actual - expected}"


# ---------------------------------------------------------------------------
# notes tools
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_notes_calls_km_get():
    from tools.notes import list_notes  # noqa: PLC0415

    assert isinstance(list_notes, BaseTool)

    with patch("tools.notes.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = [{"id": "n1", "title": "Test"}]
        result = await list_notes.ainvoke({}, config=CFG)

    mock_get.assert_awaited_once_with("/api/notes", user_id=USER)
    assert result == [{"id": "n1", "title": "Test"}]


@pytest.mark.asyncio
async def test_search_notes_calls_km_get_with_query():
    from tools.notes import search_notes  # noqa: PLC0415

    assert isinstance(search_notes, BaseTool)

    with patch("tools.notes.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = []
        await search_notes.ainvoke({"query": "transformers", "k": 5}, config=CFG)

    mock_get.assert_awaited_once_with(
        "/api/notes/search?q=transformers&k=5", user_id=USER
    )


@pytest.mark.asyncio
async def test_read_note_calls_km_get_with_id():
    from tools.notes import read_note  # noqa: PLC0415

    assert isinstance(read_note, BaseTool)

    with patch("tools.notes.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"id": "abc", "title": "Note"}
        await read_note.ainvoke({"id_or_slug": "abc"}, config=CFG)

    mock_get.assert_awaited_once_with("/api/notes/abc", user_id=USER)


@pytest.mark.asyncio
async def test_create_note_calls_km_post():
    from tools.notes import create_note  # noqa: PLC0415

    assert isinstance(create_note, BaseTool)

    with patch("tools.notes.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"id": "new1"}
        await create_note.ainvoke(
            {"title": "New Note", "contentMd": "# Hello"}, config=CFG
        )

    call_args = mock_post.call_args
    assert call_args.args[0] == "/api/notes"
    body = call_args.args[1]
    assert body["title"] == "New Note"
    assert body["contentMd"] == "# Hello"
    assert call_args.kwargs["user_id"] == USER


@pytest.mark.asyncio
async def test_update_note_calls_km_patch():
    from tools.notes import update_note  # noqa: PLC0415

    assert isinstance(update_note, BaseTool)

    with patch("tools.notes.km_patch", new_callable=AsyncMock) as mock_patch:
        mock_patch.return_value = {"updated": True}
        await update_note.ainvoke(
            {"id": "note-abc", "contentMd": "Updated"}, config=CFG
        )

    call_args = mock_patch.call_args
    assert call_args.args[0] == "/api/notes/note-abc"
    assert call_args.args[1]["contentMd"] == "Updated"
    assert call_args.kwargs["user_id"] == USER


@pytest.mark.asyncio
async def test_list_links_calls_km_get():
    from tools.notes import list_links  # noqa: PLC0415

    assert isinstance(list_links, BaseTool)

    with patch("tools.notes.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = []
        await list_links.ainvoke({"note_id": "n1"}, config=CFG)

    mock_get.assert_awaited_once_with("/api/notes/n1/links", user_id=USER)


@pytest.mark.asyncio
async def test_list_backlinks_calls_km_get():
    from tools.notes import list_backlinks  # noqa: PLC0415

    assert isinstance(list_backlinks, BaseTool)

    with patch("tools.notes.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = []
        await list_backlinks.ainvoke({"note_id": "n1"}, config=CFG)

    mock_get.assert_awaited_once_with("/api/notes/n1/backlinks", user_id=USER)


# ---------------------------------------------------------------------------
# pdfs tools
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_pdfs_calls_reader_get():
    from tools.pdfs import list_pdfs  # noqa: PLC0415

    assert isinstance(list_pdfs, BaseTool)

    with patch("tools.pdfs.reader_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = []
        await list_pdfs.ainvoke({}, config=CFG)

    mock_get.assert_awaited_once_with("/api/pdfs", user_id=USER)


@pytest.mark.asyncio
async def test_extract_passages_calls_reader_get():
    from tools.pdfs import extract_passages  # noqa: PLC0415

    assert isinstance(extract_passages, BaseTool)

    with patch("tools.pdfs.reader_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = []
        await extract_passages.ainvoke(
            {"pdf_id": "pdf1", "query": "attention", "k": 3}, config=CFG
        )

    mock_get.assert_awaited_once_with(
        "/api/pdfs/pdf1/passages?q=attention&k=3", user_id=USER
    )


@pytest.mark.asyncio
async def test_highlight_calls_reader_post():
    from tools.pdfs import highlight  # noqa: PLC0415

    assert isinstance(highlight, BaseTool)

    with patch("tools.pdfs.reader_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"id": "hl1"}
        await highlight.ainvoke(
            {"pdf_id": "pdf1", "page": 3, "range_": "0-50"}, config=CFG
        )

    call_args = mock_post.call_args
    assert call_args.args[0] == "/api/pdfs/pdf1/highlights"
    body = call_args.args[1]
    assert body["page"] == 3
    assert body["range"] == "0-50"
    assert call_args.kwargs["user_id"] == USER


@pytest.mark.asyncio
async def test_get_page_text_calls_reader_get():
    from tools.pdfs import get_page_text  # noqa: PLC0415

    assert isinstance(get_page_text, BaseTool)

    with patch("tools.pdfs.reader_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"text": "page content"}
        await get_page_text.ainvoke({"pdf_id": "pdf1", "page": 2}, config=CFG)

    mock_get.assert_awaited_once_with("/api/pdfs/pdf1/pages/2/text", user_id=USER)


# ---------------------------------------------------------------------------
# library tools
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_references_calls_reader_get():
    from tools.library import list_references  # noqa: PLC0415

    assert isinstance(list_references, BaseTool)

    with patch("tools.library.reader_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = []
        await list_references.ainvoke({}, config=CFG)

    mock_get.assert_awaited_once_with("/api/library", user_id=USER)


@pytest.mark.asyncio
async def test_list_references_with_query():
    from tools.library import list_references  # noqa: PLC0415

    with patch("tools.library.reader_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = []
        await list_references.ainvoke({"q": "neural"}, config=CFG)

    mock_get.assert_awaited_once_with("/api/library?q=neural", user_id=USER)


@pytest.mark.asyncio
async def test_get_reference_calls_reader_get():
    from tools.library import get_reference  # noqa: PLC0415

    assert isinstance(get_reference, BaseTool)

    with patch("tools.library.reader_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"id": "ref1"}
        await get_reference.ainvoke({"id": "ref1"}, config=CFG)

    mock_get.assert_awaited_once_with("/api/library/ref1", user_id=USER)


# ---------------------------------------------------------------------------
# revisions tools
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_diff_revision_calls_km_get():
    from tools.revisions import diff_revision  # noqa: PLC0415

    assert isinstance(diff_revision, BaseTool)

    with patch("tools.revisions.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"diff": "..."}
        await diff_revision.ainvoke(
            {"note_id": "n1", "rev_a": "1", "rev_b": "2"}, config=CFG
        )

    mock_get.assert_awaited_once_with(
        "/api/notes/n1/revisions/diff?rev_a=1&rev_b=2", user_id=USER
    )


@pytest.mark.asyncio
async def test_week_summary_calls_km_get():
    from tools.revisions import week_summary  # noqa: PLC0415

    assert isinstance(week_summary, BaseTool)

    with patch("tools.revisions.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {}
        await week_summary.ainvoke({"weeks": 2}, config=CFG)

    mock_get.assert_awaited_once_with("/api/activity/summary?weeks=2", user_id=USER)


@pytest.mark.asyncio
async def test_activity_calls_km_get():
    from tools.revisions import activity  # noqa: PLC0415

    assert isinstance(activity, BaseTool)

    with patch("tools.revisions.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = []
        await activity.ainvoke({"days": 7}, config=CFG)

    mock_get.assert_awaited_once_with("/api/activity?days=7", user_id=USER)


# ---------------------------------------------------------------------------
# publish tools — require_approval metadata
# ---------------------------------------------------------------------------


def test_make_public_is_base_tool():
    from tools.publish import make_public  # noqa: PLC0415

    assert isinstance(make_public, BaseTool)


def test_make_public_has_require_approval_metadata():
    """make_public must carry require_approval=True so HumanInTheLoopMiddleware
    can identify it as a tool requiring human approval before execution."""
    from tools.publish import make_public  # noqa: PLC0415

    meta = getattr(make_public, "metadata", {}) or {}
    assert meta.get("require_approval") is True, (
        f"make_public.metadata should have require_approval=True, got: {meta}"
    )


@pytest.mark.asyncio
async def test_make_public_calls_km_post():
    from tools.publish import make_public  # noqa: PLC0415

    with patch("tools.publish.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"public": True, "slug": "my-slug"}
        await make_public.ainvoke(
            {"note_id": "n1", "public_slug": "my-slug"}, config=CFG
        )

    call_args = mock_post.call_args
    assert call_args.args[0] == "/api/notes/n1/publish"
    body = call_args.args[1]
    assert body.get("public_slug") == "my-slug"
    assert call_args.kwargs["user_id"] == USER


@pytest.mark.asyncio
async def test_make_public_no_slug():
    from tools.publish import make_public  # noqa: PLC0415

    with patch("tools.publish.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"public": True}
        await make_public.ainvoke({"note_id": "n1"}, config=CFG)

    body = mock_post.call_args.args[1]
    # public_slug should be absent or None when not provided
    assert body.get("public_slug") is None or "public_slug" not in body
