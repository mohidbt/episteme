"""GSD-219 — _validate_thread_id must reject transport-unsafe thread_ids.

thread_id is interpolated unescaped into the HMAC-signed state URL path on the
km side. A `#`/`?`/`/`/whitespace char desyncs the sent path from the signed
path → a confusing 401. The authoritative validator rejects those with a clear
400 (defense-in-depth behind the km-side guard).
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from routers.km_agent import _validate_thread_id


def test_accepts_uuid_thread_id() -> None:
    tid = "3f1d2c4a-9b8e-4c7a-a1b2-c3d4e5f60718"
    assert _validate_thread_id(tid) == tid


def test_accepts_url_safe_alphabet() -> None:
    assert _validate_thread_id("abcDEF123_-") == "abcDEF123_-"


@pytest.mark.parametrize(
    "bad", ["a#b", "a?b", "a/b", "a b", "a.b", "a~b", "a%20b", "..", "a\tb"]
)
def test_rejects_transport_unsafe_chars(bad: str) -> None:
    with pytest.raises(HTTPException) as exc:
        _validate_thread_id(bad)
    assert exc.value.status_code == 400
    assert exc.value.detail == {"error": "invalid_thread_id"}


@pytest.mark.parametrize("bad", ["", None, 123, "a" * 256])
def test_rejects_empty_nonstr_overlength(bad: object) -> None:
    with pytest.raises(HTTPException) as exc:
        _validate_thread_id(bad)
    assert exc.value.status_code == 400
