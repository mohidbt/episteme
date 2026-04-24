"use client";

import Link from "next/link";
import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
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
}

export function PathPill({
  segments,
  className,
  "aria-label": ariaLabel = "Breadcrumbs",
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
        const content = <span className={labelClass}>{seg.label}</span>;
        return (
          <Fragment key={seg.id}>
            {i > 0 && (
              <ChevronRight
                aria-hidden
                className="mx-0.5 size-3 shrink-0 text-muted-foreground"
              />
            )}
            {seg.href != null ? (
              <Link
                href={seg.href}
                className={cn(
                  "rounded-md px-2 py-1 hover:bg-accent",
                  isLast ? "text-foreground" : "text-foreground",
                )}
              >
                {content}
              </Link>
            ) : (
              <span
                className={cn(
                  "px-2 py-1",
                  isLast ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {content}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
