"""K4 observability — personal skills fetch logs + SkillsBackend wiring + diag route.

Verifies that:
  1. ``_fetch_personal_skills`` emits an INFO log with the fetched count.
  2. An error-shaped km_get response is logged with the body (not just msg).
  3. ``build_km_agent`` wires the SkillsBackend with the personal slots
     observed from the km_get mock (2 in → 2 in backend._personal).
  4. A diagnostic GET ``/agents/km/skills/personal`` returns the count and
     slugs for the authed user.
"""
from __future__ import annotations

import hmac
import hashlib
import os
import time
from typing import List
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore


_TWO_PERSONAL = [
    {"slug": "check", "name": "check", "description": "the check skill", "instructions": "do checks"},
    {"slug": "note",  "name": "note",  "description": "the note skill",  "instructions": "take notes"},
]


class _NopModel(BaseChatModel):
    @property
    def _llm_type(self) -> str:
        return "fake"

    def _generate(self, messages: List[BaseMessage], **kwargs) -> ChatResult:
        return ChatResult(
            generations=[ChatGeneration(message=AIMessage(content="x", tool_calls=[]))]
        )

    def bind_tools(self, tools, **kwargs):  # type: ignore[override]
        return self


@pytest.mark.asyncio
async def test_fetch_personal_skills_logs_count_on_success(caplog):
    """On success ``_fetch_personal_skills`` must INFO-log the count."""
    import logging
    from km_agent import _fetch_personal_skills  # noqa: PLC0415

    with patch(
        "km_agent.km_get",
        new=AsyncMock(return_value={"skills": _TWO_PERSONAL}),
    ):
        with caplog.at_level(logging.INFO, logger="km_agent"):
            out = await _fetch_personal_skills("user_xyz")

    assert len(out) == 2
    matches = [
        r for r in caplog.records
        if "personal_skills" in r.getMessage() and "count=2" in r.getMessage()
    ]
    assert matches, (
        f"expected INFO log with 'personal_skills' and 'count=2'; got: "
        f"{[r.getMessage() for r in caplog.records]!r}"
    )


@pytest.mark.asyncio
async def test_fetch_personal_skills_logs_error_body_on_bad_response(caplog):
    """When km_get returns a non-dict / error-shaped body the failure must be
    visible: log the body, not just the bare 'fetch failed' string."""
    import logging
    from km_agent import _fetch_personal_skills  # noqa: PLC0415

    error_body = {"error": True, "status": 401, "path": "/api/agents/skills/personal", "body": "unauthorized"}
    with patch("km_agent.km_get", new=AsyncMock(return_value=error_body)):
        with caplog.at_level(logging.WARNING, logger="km_agent"):
            out = await _fetch_personal_skills("user_xyz")

    assert out == []
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "401" in joined or "unauthorized" in joined, (
        f"expected error body details in log; got: {joined!r}"
    )


@pytest.mark.asyncio
async def test_build_km_agent_wires_two_personal_slots_into_skills_backend():
    """End-to-end: km_get returns 2 personal skills → SkillsBackend constructed
    by ``_build_memory_backend`` has 2 entries in ``_personal``.

    We capture the ``backend=`` kwarg passed to ``create_deep_agent``, drill
    into its routes to find SkillsBackend, and assert ``len(_personal) == 2``.
    """
    from skills import load_skills  # noqa: PLC0415
    from backends.skills_backend import SkillsBackend  # noqa: PLC0415
    import km_agent as _km_agent_module  # noqa: PLC0415

    real_create = _km_agent_module.create_deep_agent
    captured: dict = {}

    def _capture(*args, **kwargs):
        captured.update(kwargs)
        return real_create(*args, **kwargs)

    mock_specs = load_skills(only=["data-extract"])
    with (
        patch("km_agent.DriveSkillsLoader") as MockLoader,
        patch("km_agent.km_get", new=AsyncMock(return_value={"skills": _TWO_PERSONAL})),
        patch("km_agent.create_deep_agent", side_effect=_capture),
    ):
        MockLoader.return_value.load = AsyncMock(return_value=mock_specs)
        await _km_agent_module.build_km_agent(
            user_id="u1",
            thread_id="t1",
            model=_NopModel(),
            enabled_skills=["data-extract"],
            approval_rules={},
            store=InMemoryStore(),
            saver=MemorySaver(),
        )

    backend = captured.get("backend")
    assert backend is not None, "create_deep_agent did not receive backend kwarg"
    # CompositeBackend exposes routes; find the SkillsBackend instance.
    routes = getattr(backend, "routes", None) or getattr(backend, "_routes", None) or {}
    skills_backend = next(
        (b for b in routes.values() if isinstance(b, SkillsBackend)),
        None,
    )
    assert skills_backend is not None, (
        f"SkillsBackend not in CompositeBackend.routes; routes={list(routes.keys())!r}"
    )
    assert len(skills_backend._personal) == 2, (
        f"expected 2 personal entries, got {len(skills_backend._personal)}: "
        f"{list(skills_backend._personal.keys())!r}"
    )
    assert set(skills_backend._personal.keys()) == {"check", "note"}


# ---------------------------------------------------------------------------
# Diagnostic route: GET /agents/km/skills/personal
# ---------------------------------------------------------------------------

_SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = _SECRET


def _signed_headers(method: str, path: str, body: bytes = b"") -> dict:
    ts = str(int(time.time()))
    msg = ts.encode() + method.encode() + path.encode() + body
    sig = hmac.new(_SECRET.encode(), msg, hashlib.sha256).hexdigest()
    return {
        "X-Inhale-User-Id": "user_diag",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
    }


def test_diagnostic_personal_skills_route_returns_count_and_slugs():
    """GET /agents/km/skills/personal returns {count, slugs} for the authed user.

    Backed by the same ``_fetch_personal_skills`` path so it reflects whatever
    the agent would see on /invoke. Mocks ``km_get`` to return 2 personal skills.
    """
    from app import app  # noqa: PLC0415

    client = TestClient(app)
    path = "/agents/km/skills/personal"

    with patch(
        "routers.km_agent.km_get",
        new=AsyncMock(return_value={"skills": _TWO_PERSONAL}),
    ):
        r = client.get(path, headers=_signed_headers("GET", path))

    assert r.status_code == 200, f"unexpected status: {r.status_code} body={r.text!r}"
    payload = r.json()
    assert payload.get("count") == 2, payload
    assert sorted(payload.get("slugs") or []) == ["check", "note"], payload


def test_diagnostic_personal_skills_route_redacts_upstream_body_on_error():
    """Security: when km_get returns an error-shaped dict the diag route MUST NOT
    echo the upstream body — that body is arbitrary content from the KM service
    and could leak credentials or PII through this internal diagnostic surface.

    Only structured fields (count, slugs, error_status, error_kind) are allowed.
    """
    from app import app  # noqa: PLC0415

    client = TestClient(app)
    path = "/agents/km/skills/personal"

    # Sentinel body content that must not appear anywhere in the response.
    sentinel = "SUPER_SECRET_LEAK_TOKEN_xyz"
    error_resp = {
        "error": True,
        "status": 502,
        "kind": "fetch_failed",
        "path": "/api/agents/skills/personal",
        "body": f"upstream said: {sentinel}",
    }

    with patch(
        "routers.km_agent.km_get",
        new=AsyncMock(return_value=error_resp),
    ):
        r = client.get(path, headers=_signed_headers("GET", path))

    assert r.status_code == 200, f"unexpected status: {r.status_code} body={r.text!r}"
    # Raw body must never reach the wire.
    assert sentinel not in r.text, (
        f"raw_error body leaked into diag response: {r.text!r}"
    )
    payload = r.json()
    # Structured shape — body/raw_error fields must be absent.
    assert payload.get("count") == 0, payload
    assert payload.get("slugs") == [], payload
    assert payload.get("error_status") == 502, payload
    assert payload.get("error_kind") == "fetch_failed", payload
    assert "body" not in payload, payload
    assert "raw_error" not in payload, payload


def test_diagnostic_personal_skills_route_excluded_from_openapi_schema():
    """The diag route is internal-only and MUST be excluded from /openapi.json
    so it does not appear in /docs (Swagger UI)."""
    from app import app  # noqa: PLC0415

    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    paths = schema.get("paths") or {}
    # The route is registered under the /agents/km prefix on the router.
    assert "/agents/km/skills/personal" not in paths, (
        f"diag route leaked into OpenAPI schema: paths={list(paths)!r}"
    )
