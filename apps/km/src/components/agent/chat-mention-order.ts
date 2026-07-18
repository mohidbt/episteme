// GSD-152 — single source of truth for @-mention dropdown ordering.
//
// The Picker renders hits grouped by kind in a fixed visual order. Keyboard
// nav walks the flat `items` array by index. To keep ArrowDown/ArrowUp linear
// (one visible row per press), the flat array MUST already be in the same
// order the Picker renders. Pre-order the fetched hits through this helper so
// `flatIndex === visualPosition` and modulo nav moves top-to-bottom cleanly.

import type { LibraryKind } from "@/lib/agent/lib-tokens";

export interface MentionHit {
  id: string;
  kind: LibraryKind;
  title: string;
}

// Must match the render order in ChatComposer's Picker component.
const KIND_ORDER: readonly LibraryKind[] = [
  "paper",
  "note",
  "reference",
  "paperset",
];

/**
 * Reorder mention hits to match the Picker's grouped visual order
 * (paper → note → reference → paperset), stable within each kind.
 * Returns a new array; does not mutate the input.
 */
export function orderHitsForDisplay(items: MentionHit[]): MentionHit[] {
  const ordered: MentionHit[] = [];
  for (const kind of KIND_ORDER) {
    for (const it of items) {
      if (it.kind === kind) ordered.push(it);
    }
  }
  return ordered;
}
