"""Process-local user config cache.

Stores per-user agent config (modelPreference, enabledSkills, approvalRules, etc.).
Defaults are returned for unknown users. Thread-safe via threading.Lock.

Guest sentinel (Task 13): the special user_id "guest" never carries skills or
approval rules. /agents/km routes 403 guest requests at the router layer; this
module also returns a hardcoded reduced shape so any in-process accidental load
cannot leak skills to a guest.
"""
import threading

_LOCK = threading.Lock()
_CACHE: dict[str, dict] = {}

GUEST_USER_ID = "guest"

_DEFAULTS = {
    "enabledSkills": [],
    "attachedMcps": [],
    "modelPreference": "google/gemma-4-31b-it:free",
    "approvalRules": {
        "publish": "require",
        "external_send": "require",
        "write_note": "auto",
    },
}

# Reduced loadout for guests — no skills, no approval rules. Phase 1.1 §5.2.
_GUEST_CONFIG = {
    "enabledSkills": [],
    "attachedMcps": [],
    "modelPreference": _DEFAULTS["modelPreference"],
    "approvalRules": {},
}


def load_user_config(user_id: str) -> dict:
    """Return the stored config for user_id, or defaults if not set.

    Guests always get the hardcoded reduced config — any persisted entry is ignored.
    """
    if user_id == GUEST_USER_ID:
        return _GUEST_CONFIG.copy()
    with _LOCK:
        return _CACHE.get(user_id, _DEFAULTS.copy())


def save_user_config(user_id: str, body: dict) -> None:
    """Persist body as the config for user_id (replaces any prior value)."""
    with _LOCK:
        _CACHE[user_id] = body
