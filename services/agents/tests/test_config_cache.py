"""Tests for lib.config_cache — including the guest sentinel (Task 13)."""
from lib import config_cache
from lib.config_cache import GUEST_USER_ID, load_user_config, save_user_config


def test_guest_user_id_constant():
    assert GUEST_USER_ID == "guest"


def test_load_user_config_for_guest_returns_empty_skills():
    """Guest config is hardcoded: no skills, default model, no approval rules."""
    cfg = load_user_config(GUEST_USER_ID)
    assert cfg["enabledSkills"] == []
    assert cfg["approvalRules"] == {}
    assert "modelPreference" in cfg


def test_load_user_config_for_guest_ignores_save_attempts():
    """Even if someone calls save_user_config('guest', ...), load returns hardcoded."""
    save_user_config(GUEST_USER_ID, {"enabledSkills": ["lit-triage"], "modelPreference": "x"})
    cfg = load_user_config(GUEST_USER_ID)
    assert cfg["enabledSkills"] == []


def test_load_user_config_for_normal_user_returns_defaults():
    config_cache._CACHE.clear()
    cfg = load_user_config("user_xyz")
    assert "enabledSkills" in cfg
    assert "modelPreference" in cfg


# ---------------------------------------------------------------------------
# Merge-on-write contract — partial save_user_config must NOT wipe defaults.
# Regression for §1.3b-E2E-1: partial PATCH used to overwrite the whole record,
# leaving load_user_config callers with a KeyError on modelPreference/approvalRules.
# ---------------------------------------------------------------------------

def test_partial_save_preserves_default_keys():
    """save_user_config({enabledSkills:[x]}) must keep modelPreference/approvalRules from defaults."""
    config_cache._CACHE.clear()
    save_user_config("user_partial", {"enabledSkills": ["lit-triage"]})
    cfg = load_user_config("user_partial")
    assert cfg["enabledSkills"] == ["lit-triage"]
    assert "modelPreference" in cfg
    assert "approvalRules" in cfg
    assert "attachedMcps" in cfg


def test_partial_save_merges_over_existing():
    """A second partial save merges over the first, not over defaults — prior keys survive."""
    config_cache._CACHE.clear()
    save_user_config("user_merge", {"enabledSkills": ["lit-triage"]})
    save_user_config("user_merge", {"modelPreference": "openai/gpt-4o"})
    cfg = load_user_config("user_merge")
    assert cfg["enabledSkills"] == ["lit-triage"]
    assert cfg["modelPreference"] == "openai/gpt-4o"


def test_load_fills_defaults_for_partially_persisted_record():
    """Defense in depth: even if _CACHE somehow holds a partial dict, load fills defaults."""
    config_cache._CACHE.clear()
    config_cache._CACHE["user_legacy"] = {"enabledSkills": ["x"]}  # bypass save
    cfg = load_user_config("user_legacy")
    assert cfg["enabledSkills"] == ["x"]
    assert "modelPreference" in cfg
    assert "approvalRules" in cfg
