/**
 * GSD-96 Round 2 — TS-side lib-token grammar serializer + parser.
 *
 * Token grammar (locked per docs/superpowers/plans/gsd-96-agent-chat-library-attach.md §3.1):
 *   [lib: kind=<paper|note|reference|paperset> id=<uuid> title="<display>"]
 *
 * Edge-case enumeration (§12 cross-round bar):
 * - empty input → no tokens, no errors
 * - single handle, all kinds (paper, note, reference, paperset)
 * - multiple handles interleaved with prose
 * - title with spaces, with embedded quotes (escaped or rejected — we
 *   document: titles are display-only, embedded `"` characters are stripped
 *   at serialize time since server resolves authoritative title)
 * - unicode / emoji in titles
 * - parser rejects malformed tokens (missing fields, bad kind, bad uuid)
 * - parser preserves cleaned text (no double-spaces, no stray `]`)
 * - round-trip: serialize then parse yields the same handles
 *
 * Omitted: concurrency, partial-failure — these are pure functions.
 */
import { describe, expect, it } from "vitest";

import {
  formatLibraryHandles,
  parseLibraryTokens,
  type LibraryHandle,
} from "../lib-tokens";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

describe("formatLibraryHandles", () => {
  it("returns empty string for no handles", () => {
    expect(formatLibraryHandles([])).toBe("");
  });

  it("emits exact grammar for a paper handle", () => {
    const h: LibraryHandle = { kind: "paper", id: UUID_A, title: "Foo et al 2024" };
    expect(formatLibraryHandles([h])).toBe(
      `[lib: kind=paper id=${UUID_A} title="Foo et al 2024"]`,
    );
  });

  it("emits all four kinds", () => {
    const handles: LibraryHandle[] = [
      { kind: "paper", id: UUID_A, title: "p" },
      { kind: "note", id: UUID_B, title: "n" },
      { kind: "reference", id: UUID_A, title: "r" },
      { kind: "paperset", id: UUID_B, title: "d" },
    ];
    const out = formatLibraryHandles(handles);
    expect(out).toContain("kind=paper");
    expect(out).toContain("kind=note");
    expect(out).toContain("kind=reference");
    expect(out).toContain("kind=paperset");
  });

  it("strips embedded double-quotes from title (display-only, server-authoritative)", () => {
    const h: LibraryHandle = { kind: "note", id: UUID_A, title: 'has "quote" inside' };
    const out = formatLibraryHandles([h]);
    expect(out).not.toContain('"quote"');
    expect(out).toContain("has quote inside");
  });

  it("preserves unicode in titles", () => {
    const h: LibraryHandle = { kind: "paper", id: UUID_A, title: "résumé 🎉" };
    expect(formatLibraryHandles([h])).toContain("résumé 🎉");
  });
});

describe("parseLibraryTokens", () => {
  it("returns empty handles + unchanged text when no tokens present", () => {
    const r = parseLibraryTokens("hello world");
    expect(r.handles).toEqual([]);
    expect(r.cleaned).toBe("hello world");
  });

  it("parses a single paper handle and strips token", () => {
    const text = `look at [lib: kind=paper id=${UUID_A} title="Foo"] please`;
    const r = parseLibraryTokens(text);
    expect(r.handles).toEqual([{ kind: "paper", id: UUID_A, title: "Foo" }]);
    expect(r.cleaned).not.toContain("[lib:");
    expect(r.cleaned).toMatch(/look at\s+please/);
  });

  it("parses multiple handles of mixed kind in document order", () => {
    const text =
      `a [lib: kind=note id=${UUID_A} title="N"] b ` +
      `[lib: kind=paperset id=${UUID_B} title="D"] c`;
    const r = parseLibraryTokens(text);
    expect(r.handles).toEqual([
      { kind: "note", id: UUID_A, title: "N" },
      { kind: "paperset", id: UUID_B, title: "D" },
    ]);
  });

  it("ignores malformed tokens (bad kind)", () => {
    const text = `[lib: kind=garbage id=${UUID_A} title="x"]`;
    const r = parseLibraryTokens(text);
    expect(r.handles).toEqual([]);
  });

  it("ignores malformed tokens (missing title field)", () => {
    const text = `[lib: kind=paper id=${UUID_A}]`;
    const r = parseLibraryTokens(text);
    expect(r.handles).toEqual([]);
  });

  it("round-trips: format then parse equals original handles", () => {
    const handles: LibraryHandle[] = [
      { kind: "paper", id: UUID_A, title: "Foo" },
      { kind: "note", id: UUID_B, title: "Bar" },
    ];
    const serialized = formatLibraryHandles(handles);
    const r = parseLibraryTokens(`prefix ${serialized} suffix`);
    expect(r.handles).toEqual(handles);
  });
});
