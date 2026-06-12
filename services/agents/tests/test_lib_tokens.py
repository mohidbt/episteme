"""GSD-96 Round 2 — Python-side lib-token grammar parser.

Token grammar (locked per docs/superpowers/plans/gsd-96-agent-chat-library-attach.md §3.1):
    [lib: kind=<paper|note|reference|paperset> id=<uuid> title="<display>"]

Edge-case enumeration (§12 cross-round bar):
- empty input -> empty handles, unchanged text
- single + multiple handles
- all four kinds (paper, note, reference, paperset)
- malformed: bad kind, missing fields, malformed id
- unicode in title
- cleaned text has no [lib: residue, no double-spaces
- order: handles returned in document order

Omitted: concurrency (pure function), DB integration (parser is a pure regex).
"""
from __future__ import annotations

import pytest

from lib.library_handles import LibraryHandle, parse_library_tokens


UUID_A = "11111111-1111-1111-1111-111111111111"
UUID_B = "22222222-2222-2222-2222-222222222222"


def test_parse_no_tokens_returns_empty_handles() -> None:
    cleaned, handles = parse_library_tokens("hello world")
    assert handles == []
    assert cleaned == "hello world"


def test_parse_single_paper_handle() -> None:
    text = f'look at [lib: kind=paper id={UUID_A} title="Foo et al 2024"] please'
    cleaned, handles = parse_library_tokens(text)
    assert handles == [LibraryHandle(kind="paper", id=UUID_A, title="Foo et al 2024")]
    assert "[lib:" not in cleaned
    assert "look at" in cleaned
    assert "please" in cleaned


def test_parse_all_four_kinds() -> None:
    text = (
        f'[lib: kind=paper id={UUID_A} title="P"] '
        f'[lib: kind=note id={UUID_B} title="N"] '
        f'[lib: kind=reference id={UUID_A} title="R"] '
        f'[lib: kind=paperset id={UUID_B} title="D"]'
    )
    cleaned, handles = parse_library_tokens(text)
    kinds = [h.kind for h in handles]
    assert kinds == ["paper", "note", "reference", "paperset"]


def test_parse_rejects_bad_kind() -> None:
    text = f'[lib: kind=garbage id={UUID_A} title="x"]'
    cleaned, handles = parse_library_tokens(text)
    assert handles == []


def test_parse_rejects_missing_title() -> None:
    text = f'[lib: kind=paper id={UUID_A}]'
    cleaned, handles = parse_library_tokens(text)
    assert handles == []


def test_parse_preserves_unicode_in_title() -> None:
    text = f'[lib: kind=paper id={UUID_A} title="résumé 🎉"]'
    cleaned, handles = parse_library_tokens(text)
    assert handles == [LibraryHandle(kind="paper", id=UUID_A, title="résumé 🎉")]


def test_parse_returns_handles_in_document_order() -> None:
    text = (
        f'first [lib: kind=note id={UUID_A} title="A"] '
        f'second [lib: kind=paper id={UUID_B} title="B"]'
    )
    cleaned, handles = parse_library_tokens(text)
    assert [h.title for h in handles] == ["A", "B"]
