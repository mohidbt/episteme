"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface CellGroundingChipProps {
  paperId: string;
  blockIds: string[];
  /** Optional override for display text (e.g. "p.5"). When null the chip is
   *  hidden; when undefined the chip derives a label from blockIds. */
  label?: string | null;
  /** Max valid page number; pills with page numbers exceeding this are hidden. */
  maxPage?: number | null;
  className?: string;
}

/**
 * Small chip rendered inside a paperset cell. Clicking opens the paper
 * viewer at the cited block: `/p/<paperId>?block=<first_block_id>`.
 *
 * Display:
 *   - `p.<page>` when the block ID carries a genuine page anchor.
 *   - Hidden otherwise (legacy/OCR-less data has only a segment/order
 *     index, which would confuse readers — e.g. "#105" on a 15-page PDF.
 *     Re-enrichment regenerates the page-anchored block IDs.) (#155)
 */
export function CellGroundingChip({
  paperId,
  blockIds,
  label,
  maxPage,
  className,
}: CellGroundingChipProps) {
  const router = useRouter();
  if (blockIds.length === 0) return null;
  const firstBlockId = blockIds[0];

  // Derive label. Explicit null hides the chip; explicit string overrides;
  // undefined → auto-derive from block ID (page first, segment fallback).
  let displayText: string | null;
  if (label === null) {
    displayText = null;
  } else if (label !== undefined) {
    displayText = label;
  } else {
    const pageNum = blockRefPageNumber(firstBlockId);
    displayText =
      pageNum !== null && (maxPage == null || pageNum <= maxPage)
        ? `p.${pageNum}`
        : null;
  }

  if (displayText === null) return null;

  const ariaLabel = `Open paper at cited block ${firstBlockId}`;

  return (
    <Badge
      variant="outline"
      className={cn("cursor-pointer hover:bg-muted", className)}
      render={
        <button
          type="button"
          aria-label={ariaLabel}
          data-testid="cell-grounding-chip"
          data-paper-id={paperId}
          data-block-id={firstBlockId}
          onClick={(e) => {
            e.stopPropagation();
            router.push(
              `/p/${paperId}?block=${encodeURIComponent(firstBlockId)}`,
            );
          }}
        />
      }
    >
      {displayText}
    </Badge>
  );
}

/**
 * Extract the page number from a block ID.
 *
 * Supports two formats:
 * - New: `<paper_id>:p<page>:<order_index>`  (from read_paper)
 * - Legacy: `block_<paperId>_p<page>_<idx>`
 * Returns null when no genuine page anchor can be parsed.
 */
export function blockRefPageNumber(blockId: string): number | null {
  // New format: paper_id:p5:12
  const newFmt = blockId.match(/:p(\d+):/);
  if (newFmt) {
    const n = Number.parseInt(newFmt[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  // Legacy format: block_123_p5_0
  const m = blockId.match(/_p(\d+)_/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Extract the segment / order-index from a block ID when no page anchor
 * is available. This is the chandra block sequence number — not a page
 * number. Used as a fallback so cells citing legacy block IDs still
 * render a clickable chip (#155).
 *
 * Supports:
 * - Legacy without page: `<paper_id>:<order_index>`  (pre-R5 read_paper)
 * - New format: trailing `:<order_index>` after `:p<page>:` is preferred
 *   via blockRefPageNumber and not handled here.
 * Returns null when nothing parseable trails the final colon.
 */
export function blockRefSegmentIndex(blockId: string): number | null {
  // Skip block IDs that already carry a page anchor — those are handled
  // by blockRefPageNumber.
  if (/:p\d+:/.test(blockId) || /_p\d+_/.test(blockId)) return null;
  const i = blockId.lastIndexOf(":");
  if (i === -1 || i === blockId.length - 1) return null;
  const n = Number.parseInt(blockId.slice(i + 1), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}