import type { EdgeKind, NodeKind } from "./types";

export type DirectedEnd = { kind: NodeKind; id: string };

/**
 * Produce a direction-aware label for a paper_citation edge, relative to
 * the currently focused/hovered node. Returns null for unrelated nodes
 * or non-citation edges.
 *
 * - When the focused node is the citer (src) → "citing"
 * - When the focused node is the cited paper (dst) → "cited in"
 */
export function paperCitationHoverLabel(
  link: { kind: EdgeKind; src: DirectedEnd; dst: DirectedEnd },
  focusedNodeKey: string | null,
): "citing" | "cited in" | null {
  if (link.kind !== "paper_citation") return null;
  if (!focusedNodeKey) return null;
  const srcKey = `${link.src.kind}:${link.src.id}`;
  const dstKey = `${link.dst.kind}:${link.dst.id}`;
  if (focusedNodeKey === srcKey) return "citing";
  if (focusedNodeKey === dstKey) return "cited in";
  return null;
}
