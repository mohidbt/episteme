import type { EdgeKind, NodeKind } from "./types";

export type LegendItem =
  | { variant: "node"; kind: NodeKind; color: string }
  | { variant: "edge"; kind: EdgeKind; color: string; dashed?: boolean };

// Single source of truth for the graph header legend. Kept narrow so we never
// drift into surfacing kinds that no longer correspond to rendered edges. The
// legacy `paper_is_ref` and `semantic_sim` entries were removed (GSD-64) — the
// former because `edgesPaperIsRef` is a no-op stub since GSD-32, the latter
// because we dropped semantic-similarity edges from the graph entirely.
export const LEGEND_ITEMS: readonly LegendItem[] = [
  { variant: "node", kind: "paper", color: "#3b82f6" },
  { variant: "node", kind: "note", color: "#22c55e" },
  { variant: "node", kind: "reference", color: "#f59e0b" },
  { variant: "edge", kind: "wiki_link", color: "#22c55e" },
  { variant: "edge", kind: "shared_tag", color: "#a1a1aa", dashed: true },
  { variant: "edge", kind: "citing", color: "#ec4899" },
];
