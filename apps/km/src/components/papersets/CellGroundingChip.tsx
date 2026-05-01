"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface CellGroundingChipProps {
  paperId: string;
  blockIds: string[];
  /** Optional override for display text (e.g. "p.5"). Falls back to block ref. */
  label?: string;
  className?: string;
}

/**
 * Small chip rendered inside a paperset cell. Clicking opens the paper
 * viewer at the cited block: `/p/<paperId>?block=<first_block_id>`.
 *
 * If `blockIds` is empty (cell is empty or "n/a"), the chip is not rendered.
 */
export function CellGroundingChip({
  paperId,
  blockIds,
  label,
  className,
}: CellGroundingChipProps) {
  const router = useRouter();
  if (blockIds.length === 0) return null;
  const firstBlockId = blockIds[0];
  const text = label ?? blockRefShort(firstBlockId);
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
      {text}
    </Badge>
  );
}

/**
 * Block ids are `<paper_id>:<order_index>` (T3/T4 spec). Show just the
 * order index when possible; fall back to the raw id.
 */
function blockRefShort(blockId: string): string {
  const i = blockId.lastIndexOf(":");
  if (i === -1 || i === blockId.length - 1) return blockId;
  return `#${blockId.slice(i + 1)}`;
}
