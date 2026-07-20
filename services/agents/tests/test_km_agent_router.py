"""Tests for routers/km_agent.py helpers.

Reader-context prefix must reference ONLY tools in ``_CORE_TOOL_NAMES``
(see ``km_agent.py``) so the side-panel agent never names a tool that has
been pruned by an active skill. In particular ``search_library`` is
skill-gated (see deep-read SKILL.md) and was a known source of
hallucination / error loops when mentioned here.
"""
import json

from routers.km_agent import (
    _build_configurable,
    _build_reader_context_prefix,
    _extract_rag_citations_from_tool_result,
)


def test_reader_context_prefix_names_core_tools():
    paper_id = "p-uuid-1234"
    prefix = _build_reader_context_prefix(paper_id)

    # Active paper id is interpolated literally
    assert paper_id in prefix
    assert prefix.startswith("[reader-context]")

    # Each guaranteed-core tool we want the model to use is named
    for tool in (
        "read_paper",
        "pdf_explain_passage",
        "find_papers",
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


def test_build_configurable_injects_ocr_and_llm_keys():
    """Tools (read_paper, pdf_explain_passage) read
    ``configurable.ocr_key`` from RunnableConfig — see
    ``services/agents/tools/papers.py:_ocr_key_from_config``. The HMAC auth
    dict carries the per-user OCR/LLM keys; the configurable builder must
    propagate them so tools don't fail with the
    "tool invoked without configurable.ocr_key" error.
    """
    auth = {
        "user_id": "u-1",
        "paper_id": None,
        "ocr_key": "ocr-test-key",
        "llm_key": "llm-test-key",
    }
    cfg = _build_configurable(
        thread_id="t-1", user_id="u-1", auth=auth, active_paper_id=None
    )
    # GSD-222: checkpoint thread_id is tenant-derived (tenant-<sha>:<client>)
    # and checkpoint_ns is "" — the client thread_id must NOT be the raw key.
    from routers.km_agent import _checkpoint_thread_key  # noqa: PLC0415

    assert cfg["thread_id"] == _checkpoint_thread_key(thread_id="t-1", user_id="u-1")
    assert cfg["thread_id"] != "t-1"
    assert cfg["checkpoint_ns"] == ""
    assert cfg["user_id"] == "u-1"
    assert cfg["ocr_key"] == "ocr-test-key"
    assert cfg["llm_key"] == "llm-test-key"
    assert "paper_id" not in cfg


def test_build_configurable_includes_active_paper_id():
    auth = {"user_id": "u-1", "ocr_key": "k", "llm_key": "l"}
    cfg = _build_configurable(
        thread_id="t-1", user_id="u-1", auth=auth, active_paper_id="p-9"
    )
    assert cfg["paper_id"] == "p-9"


def test_build_configurable_omits_empty_keys():
    """Empty-string OCR/LLM keys (e.g. unauthenticated guest path) must
    not be injected — _ocr_key_from_config rejects empty strings too."""
    auth = {"user_id": "u-1", "ocr_key": "", "llm_key": ""}
    cfg = _build_configurable(
        thread_id="t-1", user_id="u-1", auth=auth, active_paper_id=None
    )
    assert "ocr_key" not in cfg
    assert "llm_key" not in cfg


def test_extract_rag_citations_accepts_json_string_tool_output():
    """Round 2 — extractor consumes ``score`` + ``paper_title`` and emits
    ``title`` + ``score`` on each citation."""
    ev = {"name": "read_paper"}
    payload = {
        "paper_id": "p-1",
        "paper_title": "Some Paper",
        "blocks": [{"block_id": "p-1:p7:42", "page": 7, "text": "snippet", "score": 0.9}],
    }
    mapped = ("tool_result", {"output": json.dumps(payload)})
    citations = _extract_rag_citations_from_tool_result(ev, mapped)
    assert citations == [{
        "chunk_id": "p-1:p7:42",
        "paper_id": "p-1",
        "title": "Some Paper - Page 7",
        "score": 0.9,
        "page": 7,
        "snippet": "snippet",
    }]


def test_extract_rag_citations_accepts_content_block_list_tool_output():
    """Round 2 — content-block list output path still resolves to a citation
    with the new ``title``/``score`` fields and falls back to chunk_id title
    when ``paper_title`` is missing."""
    ev = {"name": "read_paper"}
    payload = {
        "paper_id": "p-2",
        "blocks": [{"block_id": "p-2:p1:3", "text": "x", "score": 0.8}],
    }
    mapped = ("tool_result", {"output": [{"type": "text", "text": json.dumps(payload)}]})
    citations = _extract_rag_citations_from_tool_result(ev, mapped)
    assert citations == [{
        "chunk_id": "p-2:p1:3",
        "paper_id": "p-2",
        "title": "p-2:p1:3",
        "score": 0.8,
        "snippet": "x",
    }]
