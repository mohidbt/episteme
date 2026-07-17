import hashlib
import hmac
import os
import time
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

import deps.db
from app import app

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET
os.environ["EPISTEME_PDF_LOCAL_TEST"] = "1"
client = TestClient(app)


def _headers(method: str, path: str, body: bytes) -> dict:
    ts = str(int(time.time()))
    sig = hmac.new(
        SECRET.encode(),
        ts.encode() + method.encode() + path.encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Inhale-User-Id": "u1",
        "X-Inhale-Paper-Id": "paper-1",
        "X-Inhale-LLM-Key": "",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


@pytest.fixture(autouse=True)
def _db_override():
    conn = AsyncMock()

    async def override():
        yield conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        yield conn
    finally:
        app.dependency_overrides.clear()


def _mk_pdf(path: str) -> None:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    with open(path, "wb") as f:
        writer.write(f)


def test_pdf_text_route_requires_auth(tmp_path):
    p = tmp_path / "x.pdf"
    _mk_pdf(str(p))
    body = f'{{"file_path":"{p}"}}'.encode()
    r = client.post("/agents/pdf/text", content=body)
    assert r.status_code == 401


def test_pdf_text_route_returns_pages(tmp_path):
    p = tmp_path / "x.pdf"
    _mk_pdf(str(p))
    body = f'{{"file_path":"{p}"}}'.encode()
    with patch(
        "routers.pdf_text.require_paper_owner",
        new_callable=AsyncMock,
        return_value={"storage_url": str(p)},
    ):
        r = client.post("/agents/pdf/text", content=body, headers=_headers("POST", "/agents/pdf/text", body))
    assert r.status_code == 200
    payload = r.json()
    assert "pages" in payload
    assert payload["pages"][0]["pageNumber"] == 1


def test_pdf_annotations_route_shape(tmp_path):
    p = tmp_path / "x.pdf"
    _mk_pdf(str(p))
    body = f'{{"file_path":"{p}"}}'.encode()
    with patch(
        "routers.pdf_text.require_paper_owner",
        new_callable=AsyncMock,
        return_value={"storage_url": str(p)},
    ):
        r = client.post(
            "/agents/pdf/annotations",
            content=body,
            headers=_headers("POST", "/agents/pdf/annotations", body),
        )
    assert r.status_code == 200
    payload = r.json()
    assert set(payload.keys()) == {"references", "markers"}


def test_pdf_text_rejects_file_path_mismatch(tmp_path):
    requested = tmp_path / "attacker.pdf"
    _mk_pdf(str(requested))
    body = f'{{"file_path":"{requested}"}}'.encode()
    with patch(
        "routers.pdf_text.require_paper_owner",
        new_callable=AsyncMock,
        return_value={"storage_url": "paper-1/source.pdf"},
    ):
        r = client.post(
            "/agents/pdf/text",
            content=body,
            headers=_headers("POST", "/agents/pdf/text", body),
        )
    assert r.status_code == 403
