import hashlib
import hmac
import os
import time
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request

FRESHNESS_SECONDS = 60
MAX_INTERNAL_BODY_BYTES = 16 * 1024 * 1024
MAX_ID_HEADER_LENGTH = 255
SIGNATURE_VERSION = "2"


def canonical_signature_message(
    *,
    ts: str,
    method: str,
    path: str,
    user_id: str,
    paper_id: str = "",
    llm_key: str = "",
    ocr_key: str = "",
    body: bytes = b"",
) -> bytes:
    """Build the versioned internal-auth HMAC message.

    Secret-bearing headers and the potentially large body are represented by
    SHA-256 hex digests. This binds them without copying raw secrets into the
    canonical message used by diagnostics/tests.
    """
    llm_digest = hashlib.sha256(llm_key.encode("utf-8")).hexdigest()
    ocr_digest = hashlib.sha256(ocr_key.encode("utf-8")).hexdigest()
    body_digest = hashlib.sha256(body).hexdigest()
    return (
        f"v2\n{ts}\n{method.upper()}\n{path}\n{user_id}\n{paper_id}\n"
        f"{llm_digest}\n{ocr_digest}\n{body_digest}"
    ).encode("utf-8")


async def require_internal(
    request: Request,
    x_inhale_user_id: Annotated[str | None, Header()] = None,
    x_inhale_paper_id: Annotated[str | None, Header()] = None,
    # NOTE: LLM key header is intentionally excluded from the signed HMAC payload.
    # Next.js decrypts and forwards the per-user key on each request. Replay risk is bounded
    # by FRESHNESS_SECONDS (60s). OCR/Datalab key is server-side only via DATALAB_API_KEY env.
    x_inhale_llm_key: Annotated[str, Header()] = "",
    x_inhale_ocr_key: Annotated[str, Header()] = "",
    x_inhale_ts: Annotated[str, Header()] = "",
    x_inhale_sig: Annotated[str, Header()] = "",
    x_inhale_sig_version: Annotated[str, Header()] = "",
) -> dict:
    if (
        not x_inhale_user_id
        or len(x_inhale_user_id) > MAX_ID_HEADER_LENGTH
        or any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in x_inhale_user_id)
    ):
        raise HTTPException(status_code=401, detail="missing user id")
    secret = os.environ.get("INHALE_INTERNAL_SECRET")
    if not secret:
        raise HTTPException(status_code=503, detail="internal auth unavailable")
    if x_inhale_sig_version != SIGNATURE_VERSION:
        raise HTTPException(status_code=401, detail="unsupported signature version")
    try:
        ts_int = int(x_inhale_ts)
    except ValueError:
        raise HTTPException(status_code=401, detail="invalid ts")
    if abs(int(time.time()) - ts_int) > FRESHNESS_SECONDS:
        raise HTTPException(status_code=401, detail="stale")

    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_INTERNAL_BODY_BYTES:
                raise HTTPException(status_code=413, detail="request body too large")
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid content-length") from None

    body = await request.body()
    if len(body) > MAX_INTERNAL_BODY_BYTES:
        raise HTTPException(status_code=413, detail="request body too large")
    # Sign path + query string to match the outbound signer in
    # services/agents/lib/km_http.py and the Next.js inbound verifiers in
    # apps/{km,reader}/src/lib/internal-auth.ts.
    signed_path = request.url.path
    if request.url.query:
        signed_path = f"{signed_path}?{request.url.query}"
    msg = canonical_signature_message(
        ts=x_inhale_ts,
        method=request.method,
        path=signed_path,
        user_id=x_inhale_user_id,
        paper_id=x_inhale_paper_id or "",
        llm_key=x_inhale_llm_key,
        ocr_key=x_inhale_ocr_key,
        body=body,
    )
    expected = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, x_inhale_sig):
        raise HTTPException(status_code=401, detail="sig mismatch")

    return {
        "user_id": x_inhale_user_id,
        "paper_id": x_inhale_paper_id or None,
        "llm_key": x_inhale_llm_key,
        "ocr_key": os.environ.get("DATALAB_API_KEY", "").strip(),
    }


InternalAuthDep = Annotated[dict, Depends(require_internal)]
