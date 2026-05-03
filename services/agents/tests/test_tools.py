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

    assert len(ALL_TOOLS) == 25, f"Expected 25, got {len(ALL_TOOLS)}"


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
        "list_folders",
        "update_note",
        "list_links",
        "list_backlinks",
        "list_pdfs",
        "search_pdfs",
        "pdf_read_text",
        "pdf_explain_passage",
        "highlight",
        "list_libraries",
        "list_references",
        "get_reference",
        "make_public",
        "agentic_search_papers",
        "agentic_fetch_papers",
        "web_search",
        "read_paper",
        "browse_papersets",
        "csv_read",
        "csv_write_cell",
        "search_library",
    } - {"make_public"}  # publish handled separately below
    expected.add("make_public")
    actual = {t.name for t in ALL_TOOLS}
    assert actual == expected, f"Missing: {expected - actual}, Extra: {actual - expected}"


def test_stubbed_tools_not_in_all_tools():
    """extract_passages, get_page_text, diff_revision, week_summary, activity
    are stubbed (no KM equivalent) and must NOT be exposed to the LLM."""
    from tools import ALL_TOOLS  # noqa: PLC0415

    names = {t.name for t in ALL_TOOLS}
    for stub in ("extract_passages", "get_page_text", "pdf_read_tables",
                 "pdf_extract_data", "diff_revision", "week_summary",
                 "activity"):
        assert stub not in names, f"stub tool {stub!r} should not be exposed"


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
async def test_create_note_omits_library_and_folder_when_unspecified():
    """Default library is resolved server-side (KM POST handler) — the tool
    must NOT send a libraryId / folderPath when the LLM omits them, so the
    KM HMAC default-library fallback fires."""
    from tools.notes import create_note  # noqa: PLC0415

    with patch("tools.notes.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"id": "n2"}
        await create_note.ainvoke(
            {"title": "T", "contentMd": "body"}, config=CFG
        )

    body = mock_post.call_args.args[1]
    assert "libraryId" not in body
    assert "folderPath" not in body
    assert "notebookId" not in body


@pytest.mark.asyncio
async def test_create_note_forwards_library_and_folder():
    from tools.notes import create_note  # noqa: PLC0415

    with patch("tools.notes.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"id": "n3"}
        await create_note.ainvoke(
            {
                "title": "T",
                "contentMd": "b",
                "library_id": 7,
                "folder_path": "research/2026",
            },
            config=CFG,
        )

    body = mock_post.call_args.args[1]
    assert body["libraryId"] == 7
    assert body["folderPath"] == "research/2026"


@pytest.mark.asyncio
async def test_list_folders_calls_km_get_default_library():
    from tools.notes import list_folders  # noqa: PLC0415

    assert isinstance(list_folders, BaseTool)
    with patch("tools.notes.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"libraryId": 1, "folders": []}
        await list_folders.ainvoke({}, config=CFG)

    mock_get.assert_awaited_once_with("/api/folders", user_id=USER)


@pytest.mark.asyncio
async def test_list_folders_passes_library_id():
    from tools.notes import list_folders  # noqa: PLC0415

    with patch("tools.notes.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"libraryId": 4, "folders": []}
        await list_folders.ainvoke({"library_id": 4}, config=CFG)

    mock_get.assert_awaited_once_with("/api/folders?libraryId=4", user_id=USER)


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
# pdfs tools (now KM-backed)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_pdfs_calls_km_get():
    from tools.pdfs import list_pdfs  # noqa: PLC0415

    assert isinstance(list_pdfs, BaseTool)

    with patch("tools.pdfs.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = []
        await list_pdfs.ainvoke({"libraryId": 1}, config=CFG)

    mock_get.assert_awaited_once_with("/api/papers?libraryId=1", user_id=USER)


@pytest.mark.asyncio
async def test_search_pdfs_calls_km_get():
    from tools.pdfs import search_pdfs  # noqa: PLC0415

    assert isinstance(search_pdfs, BaseTool)

    with patch("tools.pdfs.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"results": []}
        await search_pdfs.ainvoke({"query": "attention"}, config=CFG)

    mock_get.assert_awaited_once_with("/api/pdfs/search?q=attention", user_id=USER)


@pytest.mark.asyncio
async def test_highlight_calls_km_post():
    from tools.pdfs import highlight  # noqa: PLC0415

    assert isinstance(highlight, BaseTool)

    with patch("tools.pdfs.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"id": "hl1"}
        await highlight.ainvoke(
            {"pdf_id": "pdf1", "page": 3, "note": "important"}, config=CFG
        )

    call_args = mock_post.call_args
    assert call_args.args[0] == "/api/paper-highlights"
    body = call_args.args[1]
    assert body["paperId"] == "pdf1"
    assert body["page"] == 3
    assert body["noteMd"] == "important"
    assert call_args.kwargs["user_id"] == USER


@pytest.mark.asyncio
async def test_extract_passages_stubbed():
    from tools.pdfs import extract_passages  # noqa: PLC0415

    result = await extract_passages.ainvoke(
        {"pdf_id": "p1", "query": "x"}, config=CFG
    )
    assert isinstance(result, dict)
    assert result.get("error") is True


@pytest.mark.asyncio
async def test_get_page_text_stubbed():
    from tools.pdfs import get_page_text  # noqa: PLC0415

    result = await get_page_text.ainvoke({"pdf_id": "p1", "page": 1}, config=CFG)
    assert isinstance(result, dict)
    assert result.get("error") is True
    # pdfs_backend.read() expects {"text": ...} on success; on error it gets a
    # dict without "text" — its KeyError surfaces upstream as a tool failure,
    # which is the intended fail-loud behaviour while these are stubbed.


# ---------------------------------------------------------------------------
# library tools (now KM-backed)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_libraries_calls_km_get():
    from tools.library import list_libraries  # noqa: PLC0415

    assert isinstance(list_libraries, BaseTool)

    with patch("tools.library.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = [{"id": 1, "name": "Default"}]
        await list_libraries.ainvoke({}, config=CFG)

    mock_get.assert_awaited_once_with("/api/libraries", user_id=USER)


@pytest.mark.asyncio
async def test_list_references_calls_km_get():
    from tools.library import list_references  # noqa: PLC0415

    assert isinstance(list_references, BaseTool)

    with patch("tools.library.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = []
        await list_references.ainvoke({"libraryId": 2}, config=CFG)

    mock_get.assert_awaited_once_with(
        "/api/references?libraryId=2&limit=20&offset=0", user_id=USER
    )


@pytest.mark.asyncio
async def test_list_references_with_query():
    from tools.library import list_references  # noqa: PLC0415

    with patch("tools.library.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = []
        await list_references.ainvoke({"libraryId": 2, "q": "neural"}, config=CFG)

    mock_get.assert_awaited_once_with(
        "/api/references?libraryId=2&q=neural&limit=20&offset=0", user_id=USER
    )


@pytest.mark.asyncio
async def test_list_references_forwards_limit_and_offset():
    from tools.library import list_references  # noqa: PLC0415

    with patch("tools.library.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = []
        await list_references.ainvoke(
            {"libraryId": 2, "limit": 50, "offset": 10}, config=CFG
        )

    mock_get.assert_awaited_once_with(
        "/api/references?libraryId=2&limit=50&offset=10", user_id=USER
    )


@pytest.mark.asyncio
async def test_get_reference_calls_km_get():
    from tools.library import get_reference  # noqa: PLC0415

    assert isinstance(get_reference, BaseTool)

    with patch("tools.library.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"id": "ref1"}
        await get_reference.ainvoke({"id": "ref1"}, config=CFG)

    mock_get.assert_awaited_once_with("/api/references/ref1", user_id=USER)


# ---------------------------------------------------------------------------
# revisions tools (all stubbed — no KM equivalent)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_diff_revision_stubbed():
    from tools.revisions import diff_revision  # noqa: PLC0415

    result = await diff_revision.ainvoke(
        {"note_id": "n1", "rev_a": "1", "rev_b": "2"}, config=CFG
    )
    assert isinstance(result, dict)
    assert result.get("error") is True


@pytest.mark.asyncio
async def test_week_summary_stubbed():
    from tools.revisions import week_summary  # noqa: PLC0415

    result = await week_summary.ainvoke({"weeks": 2}, config=CFG)
    assert isinstance(result, dict)
    assert result.get("error") is True


@pytest.mark.asyncio
async def test_activity_stubbed():
    from tools.revisions import activity  # noqa: PLC0415

    result = await activity.ainvoke({"days": 7}, config=CFG)
    assert isinstance(result, dict)
    assert result.get("error") is True


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


# ---------------------------------------------------------------------------
# .episteme folder hiding (+44)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_pdfs_hides_episteme_folder_items():
    """list_pdfs must drop rows whose folderPath sits under `.episteme/**`."""
    from tools.pdfs import list_pdfs  # noqa: PLC0415

    rows = [
        {"id": "p1", "title": "A", "folderPath": "Research"},
        {"id": "p2", "title": "B", "folderPath": ".episteme/agents/memories"},
        {"id": "p3", "title": "C", "folderPath": ".episteme"},
        {"id": "p4", "title": "D", "folderPath": ""},
    ]
    with patch("tools.pdfs.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = rows
        out = await list_pdfs.ainvoke({"libraryId": 1}, config=CFG)

    assert isinstance(out, list)
    ids = [r["id"] for r in out]
    assert ids == ["p1", "p4"]


@pytest.mark.asyncio
async def test_list_references_hides_episteme_folder_items():
    """list_references must drop rows whose folderPath sits under `.episteme/**`."""
    from tools.library import list_references  # noqa: PLC0415

    rows = [
        {"id": "r1", "citationKey": "Doe2024", "folderPath": "Refs"},
        {"id": "r2", "citationKey": "X", "folderPath": ".episteme/something"},
        {"id": "r3", "citationKey": "Y", "folderPath": ".episteme"},
    ]
    with patch("tools.library.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = rows
        out = await list_references.ainvoke({"libraryId": 2}, config=CFG)

    assert isinstance(out, list)
    ids = [r["id"] for r in out]
    assert ids == ["r1"]
