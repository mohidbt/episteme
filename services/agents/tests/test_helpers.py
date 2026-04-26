"""RED tests for lib helpers: config_cache, sse_events, openrouter_model."""
import json
import os

import pytest

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET


# ---------------------------------------------------------------------------
# config_cache
# ---------------------------------------------------------------------------

class TestConfigCache:
    def setup_method(self):
        # Reset cache between tests
        from lib import config_cache  # noqa: PLC0415
        config_cache._CACHE.clear()

    def test_load_returns_defaults_for_unknown_user(self):
        from lib.config_cache import load_user_config  # noqa: PLC0415

        cfg = load_user_config("unknown-user")
        assert cfg["enabledSkills"] == []
        assert cfg["attachedMcps"] == []
        assert cfg["modelPreference"] == "google/gemma-4-31b-it:free"
        assert cfg["approvalRules"]["publish"] == "require"
        assert cfg["approvalRules"]["external_send"] == "require"
        assert cfg["approvalRules"]["write_note"] == "auto"

    def test_save_and_reload(self):
        from lib.config_cache import load_user_config, save_user_config  # noqa: PLC0415

        save_user_config("u1", {"modelPreference": "openai/gpt-4o", "approvalRules": {"publish": "auto"}})
        cfg = load_user_config("u1")
        assert cfg["modelPreference"] == "openai/gpt-4o"
        assert cfg["approvalRules"]["publish"] == "auto"

    def test_save_does_not_affect_other_users(self):
        from lib.config_cache import load_user_config, save_user_config  # noqa: PLC0415

        save_user_config("u1", {"modelPreference": "openai/gpt-4o"})
        cfg_u2 = load_user_config("u2")
        assert cfg_u2["modelPreference"] == "google/gemma-4-31b-it:free"

    def test_repeated_save_replaces_value(self):
        from lib.config_cache import load_user_config, save_user_config  # noqa: PLC0415

        save_user_config("u1", {"modelPreference": "model-a"})
        save_user_config("u1", {"modelPreference": "model-b"})
        assert load_user_config("u1")["modelPreference"] == "model-b"


# ---------------------------------------------------------------------------
# sse_events
# ---------------------------------------------------------------------------

class TestSseEvents:
    def test_format_sse_structure(self):
        from lib.sse_events import format_sse  # noqa: PLC0415

        result = format_sse("text", {"delta": "hello"})
        lines = result.split("\n")
        assert lines[0] == "event: text"
        assert lines[1].startswith("data: ")
        payload = json.loads(lines[1][len("data: "):])
        assert payload == {"delta": "hello"}
        assert result.endswith("\n\n")

    def test_format_sse_done(self):
        from lib.sse_events import format_sse  # noqa: PLC0415

        result = format_sse("done", {"thread_id": "t1"})
        assert "event: done" in result
        assert '"thread_id": "t1"' in result

    def test_format_sse_json_serializable(self):
        from lib.sse_events import format_sse  # noqa: PLC0415

        result = format_sse("error", {"message": "oops"})
        # Extract data line and parse
        for line in result.split("\n"):
            if line.startswith("data: "):
                json.loads(line[len("data: "):])
                return
        pytest.fail("no data line found")


# ---------------------------------------------------------------------------
# openrouter_model
# ---------------------------------------------------------------------------

class TestOpenrouterModel:
    def test_model_for_returns_chat_openai(self):
        from lib.openrouter_model import model_for  # noqa: PLC0415
        from langchain_openai import ChatOpenAI  # noqa: PLC0415

        m = model_for("openai/gpt-4o-mini", "sk-test-key")
        assert isinstance(m, ChatOpenAI)

    def test_model_for_sets_base_url(self):
        from lib.openrouter_model import model_for  # noqa: PLC0415
        from lib.chat import OPENROUTER_BASE  # noqa: PLC0415

        m = model_for("openai/gpt-4o-mini", "sk-test-key")
        assert str(m.openai_api_base) == OPENROUTER_BASE

    def test_model_for_passes_model_id(self):
        from lib.openrouter_model import model_for  # noqa: PLC0415

        m = model_for("openai/gpt-4o", "sk-key")
        assert m.model_name == "openai/gpt-4o"

    def test_model_for_streaming_enabled(self):
        from lib.openrouter_model import model_for  # noqa: PLC0415

        m = model_for("openai/gpt-4o", "sk-key")
        assert m.streaming is True
