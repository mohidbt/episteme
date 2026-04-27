"""RED tests for PdfsBackend."""
import os
from unittest.mock import AsyncMock, patch

import pytest

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret")

USER = "user_test_1"
# `user_id` is now passed via RunnableConfig.configurable (see §1.3b-E2E-3).
CFG = {"configurable": {"user_id": USER}}


def _make_backend(user_id: str = USER):
    from backends.pdfs_backend import PdfsBackend  # noqa: PLC0415
    return PdfsBackend(user_id=user_id)


# ---------------------------------------------------------------------------
# write / delete are read-only — must raise PermissionError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_write_raises_permission_error():
    backend = _make_backend()
    with pytest.raises(PermissionError):
        await backend.write("/pdfs/42/page1.txt", "content")


@pytest.mark.asyncio
async def test_delete_raises_permission_error():
    backend = _make_backend()
    with pytest.raises(PermissionError):
        await backend.delete("/pdfs/42/page1.txt")


# ---------------------------------------------------------------------------
# read — proxies to get_page_text
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_read_page_calls_get_page_text():
    backend = _make_backend()
    mock_tool = AsyncMock(return_value={"text": "page content here"})
    with patch("backends.pdfs_backend.get_page_text") as patched:
        patched.ainvoke = mock_tool
        result = await backend.read("/pdfs/42/page3.txt")

    mock_tool.assert_awaited_once_with({"pdf_id": "42", "page": 3}, config=CFG)
    assert result == "page content here"


@pytest.mark.asyncio
async def test_read_parses_pdf_id_and_page_correctly():
    backend = _make_backend()
    mock_tool = AsyncMock(return_value={"text": "some text"})
    with patch("backends.pdfs_backend.get_page_text") as patched:
        patched.ainvoke = mock_tool
        await backend.read("/pdfs/my-uuid-abc/page12.txt")

    mock_tool.assert_awaited_once_with({"pdf_id": "my-uuid-abc", "page": 12}, config=CFG)


# ---------------------------------------------------------------------------
# ls — proxies to list_pdfs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ls_calls_list_pdfs():
    backend = _make_backend()
    pdfs = [{"id": "pdf-1"}, {"id": "pdf-2"}]
    mock_tool = AsyncMock(return_value=pdfs)
    with patch("backends.pdfs_backend.list_pdfs") as patched:
        patched.ainvoke = mock_tool
        result = await backend.ls("/pdfs/")

    mock_tool.assert_awaited_once_with({}, config=CFG)
    assert result == ["pdf-1", "pdf-2"]
