"""Unit tests for the researcher / synthesizer / verifier subagent specs.

Each subagent is exposed as both:
- A `*_TOOL_NAMES` allow-list constant (the spec / docs contract).
- A `build_*` factory that materializes the SubAgent dict from a list of
  available BaseTool instances.

Tests assert the allow-list matches the spec verbatim and that the factory
produces the right shape (deepagents `SubAgent` / `CompiledSubAgent` TypedDict).
"""
from __future__ import annotations

import logging

from langchain_core.tools import tool

from subagents import (
    ALL_SUBAGENTS,
    RESEARCHER_TOOL_NAMES,
    SYNTHESIZER_TOOL_NAMES,
    VERIFIER_TOOL_NAMES,
    build_researcher,
    build_synthesizer,
    build_verifier,
)


def _stub_tools(names: list[str]):
    """Build minimal langchain BaseTool instances with the given names."""
    out = []
    for n in names:
        @tool(n)
        def _t(query: str = "") -> str:  # noqa: ARG001
            """Stub."""
            return ""
        out.append(_t)
    return out


# ---------------------------------------------------------------- allow-lists

def test_researcher_tool_names_match_spec():
    assert RESEARCHER_TOOL_NAMES == [
        "arxiv_search",
        "biorxiv_search",
        "pubmed_search",
        "web_search",
        "list_references",
        "search_notes",
    ]


def test_synthesizer_tool_names_match_spec():
    # synthesis SKILL.md frontmatter says: search_notes, read_note, create_note
    # Spec text: "read-only notes+pdfs, drafts into /scratch/" — no create_note.
    # The synthesizer is invoked BY the synthesis skill and writes to /scratch
    # via the deepagents StateBackend (write_file is a built-in filesystem
    # tool, not a domain tool). Domain allow-list is read-only.
    assert SYNTHESIZER_TOOL_NAMES == ["search_notes", "read_note"]


def test_verifier_tool_names_match_spec():
    assert VERIFIER_TOOL_NAMES == ["search_notes", "list_references"]


def test_no_write_tools_in_researcher():
    forbidden = {"create_note", "update_note", "highlight", "make_public"}
    assert not forbidden.intersection(RESEARCHER_TOOL_NAMES)


def test_no_write_tools_in_synthesizer_domain_allowlist():
    forbidden = {"create_note", "update_note", "highlight", "make_public"}
    assert not forbidden.intersection(SYNTHESIZER_TOOL_NAMES)


# ---------------------------------------------------------------- factories

def test_build_researcher_returns_subagent_dict():
    tools = _stub_tools(RESEARCHER_TOOL_NAMES + ["create_note"])  # incl. forbidden
    spec = build_researcher(available_tools=tools)
    assert spec["name"] == "researcher"
    assert "Fetches external literature" in spec["description"]
    assert "DOI" in spec["system_prompt"] or "arXiv" in spec["system_prompt"]
    # Only allow-listed tools are wired
    got = sorted(t.name for t in spec["tools"])
    assert got == sorted(RESEARCHER_TOOL_NAMES)


def test_build_synthesizer_returns_subagent_dict():
    tools = _stub_tools(SYNTHESIZER_TOOL_NAMES + ["create_note"])
    spec = build_synthesizer(available_tools=tools)
    assert spec["name"] == "synthesizer"
    # Citation rule must appear verbatim in system prompt.
    assert (
        "Every claim MUST be followed by a citation" in spec["system_prompt"]
    )
    assert "⚠ unsupported" in spec["system_prompt"]
    got = sorted(t.name for t in spec["tools"])
    assert got == sorted(SYNTHESIZER_TOOL_NAMES)


def test_build_verifier_returns_compiled_subagent():
    tools = _stub_tools(VERIFIER_TOOL_NAMES)
    spec = build_verifier(available_tools=tools)
    assert spec["name"] == "verifier"
    # CompiledSubAgent shape: must have a `runnable`.
    assert "runnable" in spec
    assert spec["runnable"] is not None


def test_all_subagents_exports_three_names():
    assert ALL_SUBAGENTS == ["researcher", "synthesizer", "verifier"]


# ---------------------------------------------------------------- required-tool logs


def test_build_researcher_logs_when_search_notes_missing(caplog):
    """search_notes is the only required tool for the researcher; MCP tools
    are external and may legitimately be absent."""
    import subagents.researcher as researcher_mod

    # Provide every allow-listed tool EXCEPT search_notes.
    other = [n for n in RESEARCHER_TOOL_NAMES if n != "search_notes"]
    tools = _stub_tools(other)

    with caplog.at_level(logging.INFO, logger=researcher_mod.__name__):
        build_researcher(available_tools=tools)

    assert any(
        "search_notes" in r.message and "researcher" in r.message
        for r in caplog.records
    ), f"expected info log re missing search_notes, got: {[r.message for r in caplog.records]}"


def test_build_researcher_no_log_when_required_tools_present(caplog):
    import subagents.researcher as researcher_mod

    tools = _stub_tools(RESEARCHER_TOOL_NAMES)
    with caplog.at_level(logging.INFO, logger=researcher_mod.__name__):
        build_researcher(available_tools=tools)

    assert not any(
        "without required tool" in r.message for r in caplog.records
    )


def test_build_synthesizer_logs_when_required_tool_missing(caplog):
    """synthesizer requires both search_notes AND read_note."""
    import subagents.synthesizer as synth_mod

    # Provide only search_notes; read_note missing.
    tools = _stub_tools(["search_notes"])
    with caplog.at_level(logging.INFO, logger=synth_mod.__name__):
        build_synthesizer(available_tools=tools)

    assert any(
        "read_note" in r.message and "synthesizer" in r.message
        for r in caplog.records
    ), f"expected info log re missing read_note, got: {[r.message for r in caplog.records]}"


def test_build_synthesizer_logs_each_missing_required_tool(caplog):
    import subagents.synthesizer as synth_mod

    with caplog.at_level(logging.INFO, logger=synth_mod.__name__):
        build_synthesizer(available_tools=[])

    msgs = [r.message for r in caplog.records]
    assert any("search_notes" in m for m in msgs)
    assert any("read_note" in m for m in msgs)


def test_build_synthesizer_no_log_when_required_tools_present(caplog):
    import subagents.synthesizer as synth_mod

    tools = _stub_tools(SYNTHESIZER_TOOL_NAMES)
    with caplog.at_level(logging.INFO, logger=synth_mod.__name__):
        build_synthesizer(available_tools=tools)

    assert not any(
        "without required tool" in r.message for r in caplog.records
    )
