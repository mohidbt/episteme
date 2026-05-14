"""B9 — tool descriptions for list_pdfs / search_pdfs must bias the model
toward the correct default.

Empirically the model was calling ``search_pdfs("")`` for plain "show me my
papers" requests because both docstrings led with similar verbs. The fix is
to make the descriptions explicit about WHEN each one applies.
"""
from tools.pdfs import list_pdfs, search_pdfs


def test_list_pdfs_description_marks_it_the_default_for_browse():
    desc = (list_pdfs.description or "").lower()
    assert "default" in desc, f"list_pdfs description must call itself the default: {desc!r}"
    assert "browse" in desc or "library" in desc, (
        f"list_pdfs description must mention browse/library: {desc!r}"
    )


def test_search_pdfs_description_restricts_to_specific_queries():
    desc = (search_pdfs.description or "").lower()
    # The phrase signals to the LLM that this is NOT a default fallback.
    assert "only when" in desc, (
        f"search_pdfs description must contain 'ONLY when' guidance: {desc!r}"
    )
    # Must refuse the fallback role explicitly so the model does not pick it
    # when the user only asked to list everything.
    assert "fallback" in desc or "do not use" in desc, (
        f"search_pdfs description must forbid fallback use: {desc!r}"
    )
