import sys
from pathlib import Path
from urllib.parse import urlsplit

from starlette.testclient import TestClient

# Add the service root to sys.path so `from app import app` works
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Mechanical migration adapter for legacy test-local header helpers. It only
# rewrites already-signed requests that omitted the v2 version header; missing-
# auth tests remain missing, and dedicated test_auth.py v2 vectors pass through
# unchanged. Runtime auth has no legacy branch.
_original_request = TestClient.request


def _v2_test_request(self, method, url, *args, **kwargs):
    headers = dict(kwargs.get("headers") or {})
    lowered = {str(k).lower(): str(v) for k, v in headers.items()}
    if "x-inhale-sig" in lowered and "x-inhale-sig-version" not in lowered:
        from deps.auth import canonical_signature_message
        import hashlib
        import hmac
        import os

        body = kwargs.get("content", b"")
        if isinstance(body, str):
            body = body.encode("utf-8")
        elif body is None:
            body = b""
        path = urlsplit(str(url))
        signed_path = path.path + (f"?{path.query}" if path.query else "")
        ts = lowered.get("x-inhale-ts", "")
        msg = canonical_signature_message(
            ts=ts,
            method=method,
            path=signed_path,
            user_id=lowered.get("x-inhale-user-id", ""),
            paper_id=lowered.get("x-inhale-paper-id", ""),
            llm_key=lowered.get("x-inhale-llm-key", ""),
            ocr_key=lowered.get("x-inhale-ocr-key", ""),
            body=body,
        )
        secret = os.environ["INHALE_INTERNAL_SECRET"]
        headers["X-Inhale-Sig"] = hmac.new(
            secret.encode(), msg, hashlib.sha256
        ).hexdigest()
        headers["X-Inhale-Sig-Version"] = "2"
        kwargs["headers"] = headers
    return _original_request(self, method, url, *args, **kwargs)


TestClient.request = _v2_test_request
