"use client";

import Link from "next/link";
import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

export interface PathPillSegment {
  /** Stable id used by consumers (e.g. future drop targets). folder id, or special markers like "root" or "title". */
  id: string;
  /** Display label. */
  label: string;
  /** Optional href. If null, segment renders as a non-link span (e.g. the current page title). */
  href: string | null;
}

interface Props {
  segments: PathPillSegment[];
  /** Extra className appended to outer container. */
  className?: string;
  /** aria-label on the outer nav. Defaults to "Breadcrumbs". */
  "aria-label"?: string;
  /**
   * When true, each linkable segment becomes a dnd-kit droppable so that
   * dragging a Drive item onto an ancestor segment moves it to that folder.
   * Safe to use outside a DndContext (never becomes an over-target).
   */
  segmentDropTargets?: boolean;
}

/**
 * Per-segment droppable wrapper. Split out so the hook runs the same number of
 * times regardless of which segment renders (stable hook order within the map).
 */
function SegmentLink({
  seg,
  isLast,
  labelClass,
  segmentDropTargets,
}: {
  seg: PathPillSegment;
  isLast: boolean;
  labelClass: string;
  segmentDropTargets: boolean;
}) {
  // Map "root" segment to library root (null folder id).
  const folderId = seg.id === "root" ? null : seg.id;
  const { setNodeRef, isOver } = useDroppable({
    id: `pill-drop:${seg.id}`,
    data: { kind: "ancestor", folderId },
    disabled: !segmentDropTargets || seg.href == null,
  });

  if (seg.href != null) {
    return (
      <Link
        ref={setNodeRef}
        href={seg.href}
        data-over={segmentDropTargets && isOver ? "true" : undefined}
        className={cn(
          "rounded-md px-2 py-1 hover:bg-accent",
          isLast ? "text-foreground" : "text-foreground",
          "data-[over=true]:bg-primary/15 data-[over=true]:ring-1 data-[over=true]:ring-primary/60",
        )}
      >
        <span className={labelClass}>{seg.label}</span>
      </Link>
    );
  }
  return (
    <span
      className={cn(
        "px-2 py-1",
        isLast ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span className={labelClass}>{seg.label}</span>
    </span>
  );
}

export function PathPill({
  segments,
  className,
  "aria-label": ariaLabel = "Breadcrumbs",
  segmentDropTargets = false,
}: Props) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "inline-flex max-w-full items-center gap-0 overflow-hidden rounded-lg border border-border bg-background px-1 py-1 text-sm shadow-sm",
        className,
      )}
    >
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        const isFirst = i === 0;
        const labelClass = cn(
          "block",
          !isFirst && "truncate max-w-[200px]",
          isLast && "font-medium text-foreground",
        );
        return (
          <Fragment key={seg.id}>
            {i > 0 && (
              <ChevronRight
                aria-hidden
                className="mx-0.5 size-3 shrink-0 text-muted-foreground"
              />
            )}
            <SegmentLink
              seg={seg}
              isLast={isLast}
              labelClass={labelClass}
              segmentDropTargets={segmentDropTargets}
            />
          </Fragment>
        );
      })}
    </nav>
  );
}
