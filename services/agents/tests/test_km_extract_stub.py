"""/agents/km/extract auth gate (Phase 1.4.x-T6).

The 501 stub from phase-1.4 T0 has been REPLACED by the real SSE handler.
The full SSE behaviour is covered in ``test_extract_route.py``; this module
keeps the historical auth assertion alone so the auth contract has explicit
coverage even if the SSE test file moves.
"""
import os

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)


def test_extract_requires_auth():
    """No auth headers → 401."""
    resp = client.post(
        "/agents/km/extract",
        json={"paperset_id": "x", "cells": [{"row_idx": 0, "col_name": "y"}]},
    )
    assert resp.status_code == 401
