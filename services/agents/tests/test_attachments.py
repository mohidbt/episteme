"""GSD-41 — agent-side multimodal: parse `[Attached file: ...]` tokens, fetch
assets via KM internal route, build LangChain multimodal content blocks.

RED tests for ``lib.attachments``:

1. ``parse_attachment_tokens`` extracts (name, assetId) pairs and returns
   the residual text with tokens stripped.
2. ``build_user_content`` returns a plain string when no tokens are present.
3. ``build_user_content`` returns a multimodal content list for image assets
   (base64 inline, OpenAI/OpenRouter ``image_url`` shape).
4. ``build_user_content`` inlines extracted text for PDF assets.
5. ``build_user_content`` replaces failed-fetch tokens with a human-readable
   placeholder rather than raising — never crashes the agent loop.
"""
from __future__ import annotations

import base64
from unittest.mock import AsyncMock, patch

import pytest

from lib import attachments


def test_parse_extracts_tokens_and_strips_them() -> None:
    text = (
        "look at this\n\n"
        "[Attached file: pic.png (assetId=11111111-1111-1111-1111-111111111111)] "
        "[Attached file: notes.pdf (assetId=22222222-2222-2222-2222-222222222222)]"
    )
    cleaned, parsed = attachments.parse_attachment_tokens(text)
    assert parsed == [
        ("pic.png", "11111111-1111-1111-1111-111111111111"),
        ("notes.pdf", "22222222-2222-2222-2222-222222222222"),
    ]
    assert "[Attached file:" not in cleaned
    assert "look at this" in cleaned


def test_parse_no_tokens() -> None:
    text = "hello world"
    cleaned, parsed = attachments.parse_attachment_tokens(text)
    assert cleaned == "hello world"
    assert parsed == []


@pytest.mark.asyncio
async def test_build_user_content_passthrough_without_tokens() -> None:
    out = await attachments.build_user_content("plain text", user_id="u1")
    assert out == "plain text"


@pytest.mark.asyncio
async def test_build_user_content_image_becomes_multimodal_block() -> None:
    raw = b"\x89PNG\r\n\x1a\nfake-bytes"
    meta = {"id": "a1", "filename": "pic.png", "mimeType": "image/png", "downloadUrl": "https://signed/pic"}
    with patch.object(attachments, "_fetch_asset", AsyncMock(return_value=(meta, raw))):
        msg = await attachments.build_user_content(
            "describe [Attached file: pic.png (assetId=a1)]",
            user_id="u1",
        )
    assert isinstance(msg, list)
    text_blocks = [b for b in msg if b.get("type") == "text"]
    image_blocks = [b for b in msg if b.get("type") == "image_url"]
    assert len(image_blocks) == 1
    assert image_blocks[0]["image_url"]["url"].startswith("data:image/png;base64,")
    b64 = base64.b64encode(raw).decode()
    assert b64 in image_blocks[0]["image_url"]["url"]
    # Cleaned text (token stripped) is preserved as a text block.
    assert any("describe" in b["text"] for b in text_blocks)


@pytest.mark.asyncio
async def test_build_user_content_pdf_inlines_extracted_text() -> None:
    meta = {"id": "a2", "filename": "notes.pdf", "mimeType": "application/pdf", "downloadUrl": "https://signed/n"}
    raw = b"%PDF-fake-bytes"
    with (
        patch.object(attachments, "_fetch_asset", AsyncMock(return_value=(meta, raw))),
        patch.object(attachments, "_extract_pdf_text", return_value="hello from pdf"),
    ):
        msg = await attachments.build_user_content(
            "summarize [Attached file: notes.pdf (assetId=a2)]",
            user_id="u1",
        )
    assert isinstance(msg, list)
    # Text block should mention the file + include its content.
    joined = " ".join(b["text"] for b in msg if b.get("type") == "text")
    assert "notes.pdf" in joined
    assert "hello from pdf" in joined


@pytest.mark.asyncio
async def test_build_user_content_failed_fetch_replaced_with_placeholder() -> None:
    with patch.object(attachments, "_fetch_asset", AsyncMock(return_value=None)):
        msg = await attachments.build_user_content(
            "see [Attached file: pic.png (assetId=missing)]",
            user_id="u1",
        )
    # Returns string (no multimodal blocks needed when only failures).
    assert isinstance(msg, str)
    assert "unavailable" in msg
    assert "pic.png" in msg


@pytest.mark.asyncio
async def test_fetch_asset_uses_km_get_helper_for_hmac() -> None:
    """Pin the contract: metadata fetch goes through `km_http.km_get` so the
    HMAC signer + EPISTEME_KM_BASE_URL env are picked up uniformly. A bespoke
    httpx call here would skip HMAC and 401 against KM (root cause of GSD-41
    "fetch failed" placeholders)."""
    meta = {"id": "a1", "filename": "p.png", "mimeType": "image/png", "downloadUrl": "https://signed/p"}
    mock_get = AsyncMock(return_value=meta)
    mock_resp = AsyncMock()
    mock_resp.is_success = True
    mock_resp.content = b"bytes"
    with (
        patch("lib.attachments.km_get", mock_get),
        patch.object(attachments._client, "get", AsyncMock(return_value=mock_resp)),
    ):
        result = await attachments._fetch_asset("a1", user_id="u1")
    assert result is not None
    mock_get.assert_awaited_once_with("/api/assets/a1", user_id="u1")


@pytest.mark.asyncio
async def test_fetch_asset_returns_none_when_km_get_errors() -> None:
    """km_get returns a `{"error": True, ...}` dict on non-2xx (e.g. KM 401
    because dual-auth not yet shipped to KM-prod). _fetch_asset must treat
    that as a failure and let build_user_content emit a placeholder, not
    crash the agent loop."""
    err = {"error": True, "status": 401, "path": "/api/assets/a1", "body": "unauthorized"}
    with patch("lib.attachments.km_get", AsyncMock(return_value=err)):
        result = await attachments._fetch_asset("a1", user_id="u1")
    assert result is None


@pytest.mark.asyncio
async def test_build_user_content_oversized_image_replaced_with_placeholder() -> None:
    huge = b"x" * (attachments.MAX_INLINE_BYTES + 1)
    meta = {"id": "a3", "filename": "huge.png", "mimeType": "image/png", "downloadUrl": "https://signed/h"}
    with patch.object(attachments, "_fetch_asset", AsyncMock(return_value=(meta, huge))):
        msg = await attachments.build_user_content(
            "see [Attached file: huge.png (assetId=a3)]",
            user_id="u1",
        )
    assert isinstance(msg, str)
    assert "huge.png" in msg
    assert "too large" in msg.lower() or "oversized" in msg.lower()
