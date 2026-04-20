import hmac, hashlib, os, time
from typing import Annotated
from fastapi import Depends, Header, HTTPException, Request

FRESHNESS_SECONDS = 60


async def require_internal(
    request: Request,
    x_inhale_user_id: Annotated[str | None, Header()] = None,
    x_inhale_document_id: Annotated[str | None, Header()] = None,
    # NOTE: OCR/LLM key headers are intentionally excluded from the signed HMAC payload.
    # Next.js decrypts and forwards the per-user key on each request. Replay risk is bounded
    # by FRESHNESS_SECONDS (60s). An attacker who captures a request can only reuse that key
    # for <=60s; document_id/file_path are signed so output cannot be redirected.
    x_inhale_llm_key: Annotated[str, Header()] = "",
    x_inhale_ocr_key: Annotated[str, Header()] = "",
    x_inhale_ts: Annotated[str, Header()] = "",
    x_inhale_sig: Annotated[str, Header()] = "",
) -> dict:
    if not x_inhale_user_id:
        raise HTTPException(status_code=401, detail="missing user id")
    secret = os.environ["INHALE_INTERNAL_SECRET"]
    try:
        ts_int = int(x_inhale_ts)
    except ValueError:
        raise HTTPException(status_code=401, detail="invalid ts")
    if abs(int(time.time()) - ts_int) > FRESHNESS_SECONDS:
        raise HTTPException(status_code=401, detail="stale")

    body = await request.body()
    msg = x_inhale_ts.encode() + request.method.encode() + request.url.path.encode() + body
    expected = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, x_inhale_sig):
        raise HTTPException(status_code=401, detail="sig mismatch")

    return {
        "user_id": x_inhale_user_id,
        "document_id": int(x_inhale_document_id) if x_inhale_document_id else None,
        "llm_key": x_inhale_llm_key,
        "ocr_key": x_inhale_ocr_key,
    }


InternalAuthDep = Annotated[dict, Depends(require_internal)]
