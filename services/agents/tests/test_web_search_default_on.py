"""K12 — web_search permission default-ON semantics.

The gate flips: a missing key (or None) means the tool is bound.
Only an explicit `False` filters it out.
"""
from langchain_core.tools import BaseTool

from km_agent import _filter_tools_for_permissions
from tools import ALL_TOOLS


def _has_web_search(tools: list[BaseTool]) -> bool:
    return any(t.name == "web_search" for t in tools)


def test_web_search_default_on_when_permissions_missing():
    filtered = _filter_tools_for_permissions(list(ALL_TOOLS), {})
    assert _has_web_search(filtered)


def test_web_search_default_on_when_permissions_none():
    filtered = _filter_tools_for_permissions(list(ALL_TOOLS), None)
    assert _has_web_search(filtered)


def test_web_search_default_on_when_key_missing_but_other_keys_present():
    filtered = _filter_tools_for_permissions(list(ALL_TOOLS), {"other_key": True})
    assert _has_web_search(filtered)


def test_web_search_explicit_true_kept():
    filtered = _filter_tools_for_permissions(list(ALL_TOOLS), {"web_search": True})
    assert _has_web_search(filtered)


def test_web_search_explicit_false_filtered_out():
    filtered = _filter_tools_for_permissions(list(ALL_TOOLS), {"web_search": False})
    assert not _has_web_search(filtered)


def test_web_search_none_value_treated_as_on():
    """`null` in settings_json JSON column — treat as undefined → ON."""
    filtered = _filter_tools_for_permissions(list(ALL_TOOLS), {"web_search": None})
    assert _has_web_search(filtered)
