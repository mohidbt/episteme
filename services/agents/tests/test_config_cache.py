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
