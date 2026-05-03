"""Tests for routers/km_agent.py helpers.

Reader-context prefix must reference ONLY tools in ``_CORE_TOOL_NAMES``
(see ``km_agent.py``) so the side-panel agent never names a tool that has
been pruned by an active skill. In particular ``search_library`` is
skill-gated (see deep-read SKILL.md) and was a known source of
hallucination / error loops when mentioned here.
"""
from routers.km_agent import _build_reader_context_prefix


def test_reader_context_prefix_names_core_tools():
    paper_id = "p-uuid-1234"
    prefix = _build_reader_context_prefix(paper_id)

    # Active paper id is interpolated literally
    assert paper_id in prefix
    assert prefix.startswith("[reader-context]")

    # Each guaranteed-core tool we want the model to use is named
    for tool in (
        "read_paper",
        "pdf_read_text",
        "pdf_explain_passage",
        "search_pdfs",
        "list_pdfs",
    ):
        assert tool in prefix, f"prefix missing core tool {tool!r}: {prefix}"


def test_reader_context_prefix_excludes_skill_gated_tools():
    prefix = _build_reader_context_prefix("p-uuid-xyz")

    # search_library is intentionally NOT core — must not be advertised
    # as a usable tool from the reader, since the active skill may prune it.
    # We allow it to appear ONLY inside an explicit "do NOT call" warning.
    advertised = prefix.split("Do NOT", 1)[0] if "Do NOT" in prefix else prefix
    assert "search_library" not in advertised, (
        "search_library leaked into the advertised tool list; it is skill-gated"
    )
