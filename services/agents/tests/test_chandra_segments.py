"""
Tests for the /agents/chandra-segments endpoint.

Fixtures never hit the real Chandra/Datalab API — all SDK calls are mocked.
"""

import hmac
import hashlib
import json
import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

import deps.db  # noqa: E402
from main import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from datalab_sdk.models import ConversionResult  # noqa: E402

client = TestClient(app)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PATH = "/agents/chandra-segments"


def _signed_headers(
    method: str,
    path: str,
    body: bytes,
    ocr_key: str = "ck-test-key",
) -> dict:
    ts = str(int(time.time()))
    sig = hmac.new(
        SECRET.encode(),
        ts.encode() + method.encode() + path.encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Inhale-User-Id": "user_1",
        "X-Inhale-Document-Id": "42",
        "X-Inhale-OCR-Key": ocr_key,
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


def _mock_conn() -> AsyncMock:
    conn = AsyncMock()
    conn.executemany.return_value = None
    return conn


def _fake_conversion_result(json_data: dict | None = None, page_count: int = 2) -> ConversionResult:
    """Build a ConversionResult that looks like a successful Chandra response."""
    return ConversionResult(
        success=True,
        output_format="json",
        json=json_data,
        page_count=page_count,
    )


# Minimal Chandra JSON fixture: 2 pages, each with a few blocks.
FIXTURE_JSON = {
    "block_type": "Document",
    "children": [
        {
            "block_type": "Page",
            "id": "/page/0/Page/0",
            "bbox": [0, 0, 612, 792],
            "children": [
                {
                    "block_type": "SectionHeader",
                    "id": "/page/0/SectionHeader/0",
                    "bbox": [72, 700, 540, 730],
                    "html": "<h1>Introduction</h1>",
                    "children": [],
                },
                {
                    "block_type": "Text",
                    "id": "/page/0/Text/0",
                    "bbox": [72, 600, 540, 695],
                    "html": "<p>Some paragraph text here.</p>",
                    "children": [],
                },
                {
                    "block_type": "Equation",
                    "id": "/page/0/Equation/0",
                    "bbox": [200, 550, 400, 590],
                    "html": "<math>E = mc^2</math>",
                    "children": [],
                },
                # This block_type is unmapped — should be dropped
                {
                    "block_type": "PageFooter",
                    "id": "/page/0/PageFooter/0",
                    "bbox": [72, 30, 540, 60],
                    "html": "<p>1</p>",
                    "children": [],
                },
            ],
        },
        {
            "block_type": "Page",
            "id": "/page/1/Page/0",
            "bbox": [0, 0, 612, 792],
            "children": [
                {
                    "block_type": "Figure",
                    "id": "/page/1/Figure/0",
                    "bbox": [72, 500, 540, 750],
                    "html": "<figure>Figure 1: A chart.</figure>",
                    "children": [],
                },
                {
                    "block_type": "Table",
                    "id": "/page/1/Table/0",
                    "bbox": [72, 300, 540, 490],
                    "html": "<table><tr><td>A</td><td>B</td></tr></table>",
                    "children": [],
                },
            ],
        },
    ],
}

# Page dims from fixture: 612 x 792. Stored bboxes are normalized to [0,1].
_PW, _PH = 612, 792
def _n(x0, y0, x1, y1):
    return {"x0": x0 / _PW, "y0": y0 / _PH, "x1": x1 / _PW, "y1": y1 / _PH}

EXPECTED_ROWS = [
    (0, "section_header", _n(72, 700, 540, 730), {"text": "Introduction", "heading_level": 1}),
    (0, "paragraph",     _n(72, 600, 540, 695), {"text": "Some paragraph text here."}),
    (0, "formula",       _n(200, 550, 400, 590), {"latex": "<math>E = mc^2</math>"}),
    (1, "figure",        _n(72, 500, 540, 750), {"caption": "Figure 1: A chart."}),
    (1, "table",         _n(72, 300, 540, 490), {"html": "<table><tr><td>A</td><td>B</td></tr></table>"}),
]


# ---------------------------------------------------------------------------
# 1. Parser / fixture test (no HTTP call needed)
# ---------------------------------------------------------------------------

def test_parse_blocks_produces_expected_rows():
    """Parser maps Chandra JSON blocks to the correct (page, kind, bbox, payload) tuples."""
    from routers.chandra_segments import _parse_blocks

    rows = _parse_blocks(FIXTURE_JSON)

    assert len(rows) == len(EXPECTED_ROWS), f"Expected {len(EXPECTED_ROWS)} rows, got {len(rows)}"

    for i, (got, want) in enumerate(zip(rows, EXPECTED_ROWS)):
        page, kind, bbox, payload = got
        assert page == want[0], f"row {i}: page {page!r} != {want[0]!r}"
        assert kind == want[1], f"row {i}: kind {kind!r} != {want[1]!r}"
        assert bbox == want[2], f"row {i}: bbox {bbox!r} != {want[2]!r}"
        assert payload == want[3], f"row {i}: payload {payload!r} != {want[3]!r}"


def test_parse_blocks_drops_unmapped_block_types():
    """PageFooter and other unknown block_types are silently dropped."""
    from routers.chandra_segments import _parse_blocks

    rows = _parse_blocks(FIXTURE_JSON)
    kinds = [kind for _, kind, _, _ in rows]
    # PageFooter on page 0 should not appear
    assert len([k for k in kinds if k not in {"section_header", "paragraph", "formula", "figure", "table"}]) == 0


def test_parse_blocks_empty_document():
    """An empty document returns zero rows without error."""
    from routers.chandra_segments import _parse_blocks

    assert _parse_blocks({}) == []
    assert _parse_blocks({"children": []}) == []


def test_parse_blocks_drops_missing_bbox():
    """Blocks with missing or short bbox are silently dropped (not stored with zeros)."""
    from routers.chandra_segments import _parse_blocks

    doc = {
        "children": [
            {
                "block_type": "Page",
                "id": "/page/0/Page/0",
                "bbox": [0, 0, 612, 792],
                "children": [
                    # No bbox at all
                    {
                        "block_type": "Text",
                        "id": "/page/0/Text/0",
                        "html": "<p>No bbox block</p>",
                        "children": [],
                    },
                    # bbox too short (< 4 elements)
                    {
                        "block_type": "Text",
                        "id": "/page/0/Text/1",
                        "bbox": [10, 20],
                        "html": "<p>Short bbox block</p>",
                        "children": [],
                    },
                    # Valid block — should be kept
                    {
                        "block_type": "Text",
                        "id": "/page/0/Text/2",
                        "bbox": [72, 600, 540, 695],
                        "html": "<p>Valid block</p>",
                        "children": [],
                    },
                ],
            }
        ]
    }

    rows = _parse_blocks(doc)
    assert len(rows) == 1, f"Expected 1 row (valid block only), got {len(rows)}"
    assert rows[0][2] == _n(72, 600, 540, 695)


def test_html_unescape_in_caption():
    """html.unescape is applied to text fields — entities like &amp; are decoded."""
    from routers.chandra_segments import _parse_blocks

    doc = {
        "children": [
            {
                "block_type": "Page",
                "id": "/page/0/Page/0",
                "bbox": [0, 0, 612, 792],
                "children": [
                    {
                        "block_type": "Figure",
                        "id": "/page/0/Figure/0",
                        "bbox": [72, 500, 540, 750],
                        "html": "<figure>Tom &amp; Jerry &lt;the cartoon&gt;</figure>",
                        "children": [],
                    },
                ],
            }
        ]
    }

    rows = _parse_blocks(doc)
    assert len(rows) == 1
    caption = rows[0][3]["caption"]
    assert caption == "Tom & Jerry <the cartoon>", f"Got: {caption!r}"


# ---------------------------------------------------------------------------
# 2. No-key test — silent skip, zero DB inserts
# ---------------------------------------------------------------------------

def test_no_ocr_key_returns_skipped():
    """Missing/empty X-Inhale-OCR-Key → 200 with skipped=true, no DB write."""
    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        body = json.dumps({"document_id": 42, "file_path": "/tmp/test.pdf"}).encode()
        headers = _signed_headers("POST", PATH, body, ocr_key="")
        # Remove the OCR key header entirely
        headers.pop("X-Inhale-OCR-Key", None)

        r = client.post(PATH, content=body, headers=headers)

        assert r.status_code == 200
        data = r.json()
        assert data["success"] is True
        assert data["skipped"] is True
        assert data["segment_count"] == 0
        assert data["page_count"] == 0

        mock_conn.executemany.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_empty_ocr_key_returns_skipped():
    """Empty string X-Inhale-OCR-Key → same skipped response."""
    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        body = json.dumps({"document_id": 42, "file_path": "/tmp/test.pdf"}).encode()
        r = client.post(
            PATH,
            content=body,
            headers=_signed_headers("POST", PATH, body, ocr_key=""),
        )
        assert r.status_code == 200
        assert r.json()["skipped"] is True
        mock_conn.executemany.assert_not_called()
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# 3. Auth test — missing HMAC signature → 401
# ---------------------------------------------------------------------------

def test_missing_sig_returns_401():
    """Request without HMAC headers → 401."""
    body = json.dumps({"document_id": 42, "file_path": "/tmp/test.pdf"}).encode()
    r = client.post(PATH, content=body, headers={"Content-Type": "application/json"})
    assert r.status_code == 401


def test_bad_sig_returns_401():
    """Correct headers but wrong signature → 401."""
    body = json.dumps({"document_id": 42, "file_path": "/tmp/test.pdf"}).encode()
    headers = _signed_headers("POST", PATH, body)
    headers["X-Inhale-Sig"] = "deadbeef" * 8  # wrong sig
    r = client.post(PATH, content=body, headers=headers)
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# 4. DB insert test — executemany called with correct row count
# ---------------------------------------------------------------------------

def test_happy_path_inserts_segments():
    """Mocked Chandra call → parser produces rows → executemany called with right count."""
    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    fake_result = _fake_conversion_result(json_data=FIXTURE_JSON, page_count=2)

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        body = json.dumps({"document_id": 42, "file_path": "/tmp/test.pdf"}).encode()

        with patch(
            "routers.chandra_segments._run_chandra",
            new_callable=AsyncMock,
            return_value=fake_result,
        ):
            r = client.post(
                PATH,
                content=body,
                headers=_signed_headers("POST", PATH, body),
            )

        assert r.status_code == 200
        data = r.json()
        assert data["success"] is True
        assert data["skipped"] is False
        assert data["segment_count"] == len(EXPECTED_ROWS)  # 5 rows
        assert data["page_count"] == 2

        # executemany should have been called once with 5 row tuples
        mock_conn.executemany.assert_called_once()
        call_args = mock_conn.executemany.call_args
        sql, rows = call_args[0]
        assert "INSERT INTO document_segments" in sql
        # Assert exact column names to catch future column-name drift
        assert "(document_id, page, kind, bbox, payload, order_index)" in sql
        assert len(rows) == len(EXPECTED_ROWS)

        # Spot-check the first row structure: (document_id, page, kind, bbox_json, payload_json, order_index)
        first = rows[0]
        assert first[0] == 42          # document_id
        assert first[1] == 0           # page
        assert first[2] == "section_header"
        assert json.loads(first[3]) == _n(72, 700, 540, 730)
        assert json.loads(first[4]) == {"text": "Introduction", "heading_level": 1}
        assert first[5] == 0           # order_index
    finally:
        app.dependency_overrides.clear()


def test_chandra_failure_returns_zero_segments():
    """If Chandra returns success=False or no json, we return 0 segments and don't insert."""
    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    # Simulate Chandra failure
    failed_result = ConversionResult(
        success=False,
        output_format="json",
        json=None,
        page_count=0,
        error="API error",
    )

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        body = json.dumps({"document_id": 42, "file_path": "/tmp/test.pdf"}).encode()

        with patch(
            "routers.chandra_segments._run_chandra",
            new_callable=AsyncMock,
            return_value=failed_result,
        ):
            r = client.post(
                PATH,
                content=body,
                headers=_signed_headers("POST", PATH, body),
            )

        assert r.status_code == 200
        data = r.json()
        assert data["success"] is True
        assert data["segment_count"] == 0
        mock_conn.executemany.assert_not_called()
    finally:
        app.dependency_overrides.clear()
