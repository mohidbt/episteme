// GSD-152 — RED. The @-mention dropdown renders hits grouped by kind in a
// fixed visual order (paper, note, reference, paperset), but keyboard nav
// walks the *flat* `items` array in fetch order. When the fetch order differs
// from the grouped render order, ArrowDown skips/jumps between groups instead
// of moving one visible row at a time.
//
// `orderHitsForDisplay` is the single source of truth for BOTH the visual
// order and the keyboard-nav order: once the flat array is pre-ordered to
// match the rendered grouping, `selected` increments linearly down the list.

import { describe, it, expect } from "vitest";
import { orderHitsForDisplay, type MentionHit } from "./chat-mention-order";

const hit = (kind: MentionHit["kind"], id: string): MentionHit => ({
  id,
  kind,
  title: `${kind}-${id}`,
});

describe("orderHitsForDisplay", () => {
  it("orders hits by kind group (paper, note, reference, paperset)", () => {
    const input = [
      hit("note", "n1"),
      hit("paper", "p1"),
      hit("reference", "r1"),
      hit("paperset", "s1"),
    ];
    const out = orderHitsForDisplay(input);
    expect(out.map((h) => h.kind)).toEqual([
      "paper",
      "note",
      "reference",
      "paperset",
    ]);
  });

  it("is stable within a kind group (preserves fetch order per kind)", () => {
    const input = [
      hit("paper", "p2"),
      hit("note", "n1"),
      hit("paper", "p1"),
      hit("note", "n2"),
    ];
    const out = orderHitsForDisplay(input);
    expect(out.map((h) => h.id)).toEqual(["p2", "p1", "n1", "n2"]);
  });

  it("matches the visual grouping so flat index == visual position (linear nav)", () => {
    // A note fetched BEFORE any paper is the exact non-linearity trigger:
    // in fetch order the note sits at flat index 0, but the Picker renders
    // it AFTER all papers. After ordering, the flat index of each hit equals
    // its rendered position, so ArrowDown moves exactly one visible row.
    const input = [
      hit("note", "n1"),
      hit("paper", "p1"),
      hit("paper", "p2"),
    ];
    const out = orderHitsForDisplay(input);
    // Rendered order: papers first, then the note.
    expect(out.map((h) => h.id)).toEqual(["p1", "p2", "n1"]);
    // Walking flat indices 0,1,2 visits rows in visual top-to-bottom order.
    out.forEach((h, i) => {
      expect(out.indexOf(h)).toBe(i);
    });
  });

  it("returns a new array and does not mutate the input", () => {
    const input = [hit("note", "n1"), hit("paper", "p1")];
    const copy = [...input];
    orderHitsForDisplay(input);
    expect(input).toEqual(copy);
  });

  it("handles an empty list", () => {
    expect(orderHitsForDisplay([])).toEqual([]);
  });
});
