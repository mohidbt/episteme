"""RED test for §1.3b-E2E-3: tool user_id must come from RunnableConfig, not LLM args.

The agent's `read_note` (and every other domain tool) must NOT expose user_id in
its tool_call_schema — otherwise the LLM has to guess/fabricate a user_id and
apps/km returns 403 because the HMAC X-Inhale-User-Id header doesn't match the
note's owner.

The fix: tools read user_id from `config["configurable"]["user_id"]` injected
by the agent router at /invoke time. The LLM only sees domain args.
"""
import os
from unittest.mock import AsyncMock, patch

import pytest

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")


def test_read_note_schema_excludes_user_id():
    """The schema sent to the LLM must NOT contain user_id — it's auth context,
    not something the LLM can or should provide."""
    from tools.notes import read_note  # noqa: PLC0415

    schema = read_note.tool_call_schema.model_json_schema()
    props = schema.get("properties", {})
    assert "user_id" not in props, (
        f"read_note tool_call_schema should hide user_id from the LLM, "
        f"got props: {list(props)}"
    )


@pytest.mark.asyncio
async def test_read_note_pulls_user_id_from_runnable_config():
    """When invoked with a RunnableConfig that carries configurable.user_id,
    read_note must forward THAT user_id to km_get — not whatever the LLM
    provided in args."""
    from tools.notes import read_note  # noqa: PLC0415

    with patch("tools.notes.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"id": "abc"}
        await read_note.ainvoke(
            {"id_or_slug": "abc"},
            config={"configurable": {"user_id": "real-user-from-auth"}},
        )

    mock_get.assert_awaited_once_with("/api/notes/abc", user_id="real-user-from-auth")


@pytest.mark.asyncio
async def test_all_domain_tools_hide_user_id_from_llm_schema():
    """Every domain tool that does an authed call must hide user_id from the
    LLM-facing schema. Otherwise the LLM has to invent a user_id, and the
    HMAC ownership check on apps/km returns 403."""
    from tools import ALL_TOOLS  # noqa: PLC0415

    offenders: list[str] = []
    for t in ALL_TOOLS:
        props = t.tool_call_schema.model_json_schema().get("properties", {})
        if "user_id" in props:
            offenders.append(t.name)
    assert not offenders, (
        f"these tools still expose user_id to the LLM (must be runtime-injected): {offenders}"
    )
