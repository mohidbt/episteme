"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface CellGroundingChipProps {
  paperId: string;
  blockIds: string[];
  /** Optional override for display text (e.g. "p.5"). When null the chip is
   *  hidden; when undefined the chip derives a page label from blockIds. */
  label?: string | null;
  /** Max valid page number; pills with page numbers exceeding this are hidden. */
  maxPage?: number | null;
  className?: string;
}

/**
 * Small chip rendered inside a paperset cell. Clicking opens the paper
 * viewer at the cited block: `/p/<paperId>?block=<first_block_id>`.
 *
 * Only rendered when a valid page number can be derived from the block ID
 * and (when maxPage is provided) the page number doesn't exceed it.
 * Block IDs that don't carry a genuine page anchor are silently hidden —
 * see #104.
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

  // Derive page number from label or block ID. If label is explicitly null,
  // hide the chip. If label is a string, use it. Otherwise, try extracting
  // from the block ID.
  let displayText: string | null;
  if (label === null) {
    displayText = null;
  } else if (label !== undefined) {
    displayText = label;
  } else {
    const pageNum = blockRefPageNumber(firstBlockId);
    displayText = pageNum !== null ? `p.${pageNum}` : null;
  }

  // #104: validate page number against maxPage when provided
  if (displayText === null) return null;
  if (maxPage != null) {
    const pageNum = blockRefPageNumber(firstBlockId);
    if (pageNum !== null && pageNum > maxPage) return null;
  }

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