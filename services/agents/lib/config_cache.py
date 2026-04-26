"""Process-local user config cache.

Stores per-user agent config (modelPreference, enabledSkills, approvalRules, etc.).
Defaults are returned for unknown users. Thread-safe via threading.Lock.
"""
import threading

_LOCK = threading.Lock()
_CACHE: dict[str, dict] = {}

_DEFAULTS = {
    "enabledSkills": [],
    "attachedMcps": [],
    "modelPreference": "openai/gpt-4o-mini",
    "approvalRules": {
        "publish": "require",
        "external_send": "require",
        "write_note": "auto",
    },
}


def load_user_config(user_id: str) -> dict:
    """Return the stored config for user_id, or defaults if not set."""
    with _LOCK:
        return _CACHE.get(user_id, _DEFAULTS.copy())


def save_user_config(user_id: str, body: dict) -> None:
    """Persist body as the config for user_id (replaces any prior value)."""
    with _LOCK:
        _CACHE[user_id] = body
