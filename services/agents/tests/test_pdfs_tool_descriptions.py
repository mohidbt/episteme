"""Tool surface for finding papers — single ``find_papers`` entry point.

Replaces the prior list_pdfs / search_pdfs pair so the system prompt
doesn't need a tool-choice rule. Tests pin the consolidated docstring
contract: optional query, empty-result fallback to full list.
"""
from tools.pdfs import TOOLS, find_papers


def test_find_papers_is_exposed_to_llm():
    names = {t.name for t in TOOLS}
    assert "find_papers" in names, f"find_papers must be in TOOLS, got {names}"
    assert "list_pdfs" not in names, (
        "list_pdfs must be removed from LLM-facing TOOLS (use find_papers)"
    )
    assert "search_pdfs" not in names, (
        "search_pdfs must be removed from LLM-facing TOOLS (use find_papers)"
    )


def test_find_papers_description_documents_optional_query():
    desc = (find_papers.description or "").lower()
    assert "query" in desc
    assert "no query" in desc or "leave none" in desc or "default behavior" in desc, (
        f"find_papers must teach the model that omitting query lists all: {desc!r}"
    )


def test_find_papers_description_documents_zero_hit_fallback():
    desc = (find_papers.description or "").lower()
    assert "fallback" in desc or "dead-end" in desc, (
        f"find_papers must promise a zero-hit fallback in its docstring: {desc!r}"
    )
