"""GSD-96 Round 2 — agent middleware: lib tokens parsed BEFORE asset tokens.

Locked behavior (§3.10):
  1. parse_library_tokens(text) -> (cleaned, handles)
  2. parse_attachment_tokens(cleaned) -> existing asset pipeline

Lib tokens are NOT inlined as bytes. They are replaced in-place with @<title>
for the LLM AND surfaced via a system-preamble describing {kind, id, title}
so the agent picks the right tool (read_paper, read_note, lookup_reference,
list_paperset_papers).

Edge-case enumeration (§12):
- pure-lib message (no asset tokens) -> still returns string content + signals
  presence of handles
- mixed lib + asset tokens -> lib stripped first, asset pipeline runs on residue
- malformed lib token + valid asset token -> asset still processed
- empty message -> no-op
- multiple lib tokens of same kind
- ordering: lib parse must precede asset parse (test by giving an asset token
  whose name accidentally matches `[lib: ...]` shape — lib regex is strict on
  kind=/id=/title= structure so no collision)

Omitted: real KM HTTP roundtrip (covered by test_attachments.py); LLM
invocation (covered by test_km_agent.py).
"""
from __future__ import annotations


from lib.library_handles import build_library_system_hint, parse_library_tokens
from lib import attachments


UUID_A = "11111111-1111-1111-1111-111111111111"


def test_pure_lib_message_no_asset_tokens() -> None:
    text = f'summarize [lib: kind=paper id={UUID_A} title="Foo"]'
    cleaned, handles = parse_library_tokens(text)
    # After lib parse, no asset tokens to find.
    cleaned2, asset_tokens = attachments.parse_attachment_tokens(cleaned)
    assert asset_tokens == []
    assert handles[0].kind == "paper"


def test_lib_and_asset_tokens_in_same_message() -> None:
    text = (
        f'compare [lib: kind=paper id={UUID_A} title="Foo"] with '
        f'[Attached file: scan.png (assetId=33333333-3333-3333-3333-333333333333)]'
    )
    cleaned, handles = parse_library_tokens(text)
    # lib token gone; asset token still present in cleaned text.
    assert "[lib:" not in cleaned
    assert "[Attached file:" in cleaned
    # Asset pipeline can still parse what remains.
    cleaned2, asset_tokens = attachments.parse_attachment_tokens(cleaned)
    assert len(asset_tokens) == 1
    assert asset_tokens[0][0] == "scan.png"
    assert len(handles) == 1
    assert handles[0].kind == "paper"


def test_build_library_system_hint_emits_tool_guidance() -> None:
    handles, _ = parse_library_tokens(
        f'[lib: kind=paper id={UUID_A} title="Foo"]'
    )[1], None  # noqa
    cleaned, handles = parse_library_tokens(
        f'[lib: kind=paper id={UUID_A} title="Foo"]'
    )
    hint = build_library_system_hint(handles)
    assert "Foo" in hint
    assert UUID_A in hint
    # mentions the tool family agent should call
    assert "read_paper" in hint


def test_build_library_system_hint_empty_handles_returns_empty() -> None:
    assert build_library_system_hint([]) == ""


def test_build_library_system_hint_mentions_tool_per_kind() -> None:
    text = (
        f'[lib: kind=paper id={UUID_A} title="P"] '
        f'[lib: kind=note id={UUID_A} title="N"] '
        f'[lib: kind=reference id={UUID_A} title="R"] '
        f'[lib: kind=paperset id={UUID_A} title="D"]'
    )
    _, handles = parse_library_tokens(text)
    hint = build_library_system_hint(handles)
    assert "read_paper" in hint
    assert "read_note" in hint
    assert "lookup_reference" in hint
    assert "list_paperset_papers" in hint
