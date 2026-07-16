"""GSD-41 — parse `[Attached file: <name> (assetId=<id>)]` tokens in user
messages and turn them into LangChain multimodal content blocks.

Flow
----
1. Regex-scan the user text for tokens.
2. For each token, call KM `/api/assets/<id>` (HMAC) to get `{mimeType,
   downloadUrl, ...}`, then GET the presigned URL for raw bytes.
3. Images  → ``{"type": "image_url", "image_url": {"url": "data:<mime>;base64,<b64>"}}``
   (OpenAI/OpenRouter shape supported by ``langchain-openai``'s ChatOpenAI).
4. PDFs    → extract text with pypdf, inline as text block.
5. Other   → inline a short placeholder note ("attachment of type X").

Errors (fetch failed, asset missing, oversized) replace the token in-place
with a human-readable placeholder so the agent loop never crashes — same
philosophy as ``lib/km_http.py::_safe_response``.
"""
from __future__ import annotations

import base64
import ipaddress
import io
import logging
import os
import re
from urllib.parse import urlsplit

import httpx

from lib.km_http import _client, km_get

logger = logging.getLogger(__name__)

# Token shape mirrors apps/km/src/components/agent/ChatFileAttachments.tsx
# `formatMessageWithAttachments`. Filename can contain spaces; assetId is a
# UUID written by the KM POST /api/assets handler.
_TOKEN_RE = re.compile(
    r"\[Attached file:\s*(?P<name>[^\(]+?)\s*\(assetId=(?P<id>[A-Za-z0-9\-]+)\)\]"
)

# 10 MB ceiling on inline bytes — protects context budget and avoids blowing
# past OpenRouter's per-request body limit. Anything larger gets a placeholder.
MAX_INLINE_BYTES = 10 * 1024 * 1024

# Cap inlined PDF text per attachment so a 200-page PDF doesn't dominate the
# turn. Roughly ~20K characters ≈ ~5K tokens.
_MAX_PDF_TEXT_CHARS = 20_000


def _safe_download_url(value: str) -> bool:
    """Reject URL forms that can target local services or smuggle credentials.

    Asset URLs are minted by the trusted KM storage adapter, but validating
    again here prevents a compromised/malformed metadata response from
    turning the agents service into an SSRF primitive. Redirects remain
    disabled on the shared httpx client.
    """
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    if parsed.username is not None or parsed.password is not None or parsed.fragment:
        return False
    def origin(url: str) -> tuple[str, str, int] | None:
        try:
            item = urlsplit(url)
            if not item.hostname or item.scheme not in {"http", "https"}:
                return None
            port = item.port or (443 if item.scheme == "https" else 80)
            return item.scheme, item.hostname.rstrip(".").lower(), port
        except ValueError:
            return None

    allowed_values = [os.environ.get("S3_ENDPOINT", "")]
    allowed_values.extend(
        item.strip()
        for item in os.environ.get("EPISTEME_ATTACHMENT_ALLOWED_ORIGINS", "").split(",")
        if item.strip()
    )
    candidate = origin(value)
    if candidate is None or candidate not in {origin(item) for item in allowed_values if item}:
        return False

    scheme, hostname, _port = candidate
    if scheme == "https":
        return True
    # Local MinIO is intentionally opt-in. Never allow cleartext downloads to
    # a non-loopback host, even if it was accidentally placed in the allowlist.
    try:
        is_loopback = ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        is_loopback = hostname == "localhost"
    return is_loopback and os.environ.get(
        "EPISTEME_ALLOW_INSECURE_ATTACHMENT_URLS"
    ) == "1"


async def _download_limited(url: str) -> bytes | None:
    """Stream a download and stop before buffering more than the inline cap."""
    try:
        async with _client.stream("GET", url, follow_redirects=False) as resp:
            if not resp.is_success:
                return None
            content_length = resp.headers.get("content-length")
            if content_length:
                try:
                    if int(content_length) > MAX_INLINE_BYTES:
                        return None
                except ValueError:
                    return None
            chunks = bytearray()
            async for chunk in resp.aiter_bytes():
                if len(chunks) + len(chunk) > MAX_INLINE_BYTES:
                    return None
                chunks.extend(chunk)
            return bytes(chunks)
    except httpx.RequestError:
        return None


def parse_attachment_tokens(text: str) -> tuple[str, list[tuple[str, str]]]:
    """Strip `[Attached file: ...]` tokens from ``text``.

    Returns ``(cleaned_text, [(filename, asset_id), ...])`` in document order.
    """
    parsed: list[tuple[str, str]] = []
    for m in _TOKEN_RE.finditer(text):
        parsed.append((m.group("name").strip(), m.group("id")))
    cleaned = _TOKEN_RE.sub("", text)
    # Collapse the double-newline that the client injects before the token bag.
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned, parsed


async def _fetch_asset(asset_id: str, *, user_id: str) -> tuple[dict, bytes] | None:
    """Fetch ``(metadata, raw_bytes)`` for ``asset_id`` or return None on failure.

    Hits the KM internal route (HMAC-signed) to get the metadata + presigned
    download URL, then GETs the raw bytes from object storage.
    """
    meta = await km_get(f"/api/assets/{asset_id}", user_id=user_id)
    if not isinstance(meta, dict) or meta.get("error"):
        logger.warning("attachment fetch: metadata failed asset=%s resp=%r", asset_id, meta)
        return None
    download_url = meta.get("downloadUrl")
    if not isinstance(download_url, str) or not _safe_download_url(download_url):
        logger.warning("attachment fetch: no downloadUrl asset=%s", asset_id)
        return None
    raw = await _download_limited(download_url)
    if raw is None:
        logger.warning("attachment fetch: bytes failed or oversized asset=%s", asset_id)
        return None
    return meta, raw


def _extract_pdf_text(raw: bytes) -> str:
    """Best-effort plain-text extraction from PDF bytes (pypdf).

    Returns empty string if pypdf can't read the file — caller turns that
    into a placeholder rather than raising.
    """
    try:
        from pypdf import PdfReader  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        logger.exception("pypdf unavailable")
        return ""
    try:
        reader = PdfReader(io.BytesIO(raw))
        chunks: list[str] = []
        for page in reader.pages:
            chunks.append(page.extract_text() or "")
        return "\n\n".join(chunks).strip()
    except Exception:  # noqa: BLE001
        logger.exception("pdf text extract failed")
        return ""


def _placeholder(name: str, reason: str) -> str:
    return f"[Attached file: {name} (unavailable: {reason})]"


async def build_user_content(text: str, *, user_id: str) -> str | list[dict]:
    """Translate ``text`` into a LangChain message content payload.

    No tokens → returns ``text`` unchanged (string content).
    Tokens present → returns a content-block list with cleaned text + one
    ``image_url`` block per inline image + PDF text inlined as additional
    text blocks. Tokens that fail to fetch are replaced with placeholders;
    if every token failed, returns a string (no multimodal upgrade).
    """
    cleaned, tokens = parse_attachment_tokens(text)
    if not tokens:
        return text

    image_blocks: list[dict] = []
    extra_text: list[str] = []
    placeholders: list[str] = []

    for name, asset_id in tokens:
        fetched = await _fetch_asset(asset_id, user_id=user_id)
        if fetched is None:
            placeholders.append(_placeholder(name, "fetch failed"))
            continue
        meta, raw = fetched
        if len(raw) > MAX_INLINE_BYTES:
            placeholders.append(_placeholder(name, "oversized"))
            continue
        mime = str(meta.get("mimeType") or "").lower()
        if mime.startswith("image/"):
            b64 = base64.b64encode(raw).decode()
            image_blocks.append({
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}"},
            })
        elif mime == "application/pdf":
            extracted = _extract_pdf_text(raw)
            if not extracted:
                placeholders.append(_placeholder(name, "could not read pdf"))
            else:
                if len(extracted) > _MAX_PDF_TEXT_CHARS:
                    extracted = extracted[:_MAX_PDF_TEXT_CHARS] + "\n…(truncated)"
                extra_text.append(f"--- Attached PDF: {name} ---\n{extracted}")
        elif mime.startswith("text/"):
            try:
                decoded = raw.decode("utf-8", errors="replace")
            except Exception:  # noqa: BLE001
                decoded = ""
            if decoded:
                extra_text.append(f"--- Attached file: {name} ---\n{decoded[:_MAX_PDF_TEXT_CHARS]}")
            else:
                placeholders.append(_placeholder(name, "could not decode text"))
        else:
            placeholders.append(_placeholder(name, f"unsupported type {mime or 'unknown'}"))

    if not image_blocks and not extra_text:
        # Every token failed — keep as plain string with placeholders inline.
        return (cleaned + "\n\n" + "\n".join(placeholders)).strip()

    blocks: list[dict] = []
    head_text = cleaned
    if placeholders:
        head_text = (cleaned + "\n\n" + "\n".join(placeholders)).strip()
    if head_text:
        blocks.append({"type": "text", "text": head_text})
    for chunk in extra_text:
        blocks.append({"type": "text", "text": chunk})
    blocks.extend(image_blocks)
    return blocks
