"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface PaperCardProps {
  id: string;
  title: string | null;
  filename: string;
  authors: string[] | null;
  year: number | null;
}

function formatAuthors(authors: string[] | null): string | null {
  if (!authors || authors.length === 0) return null;
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")}, …`;
}

export function PaperCard({ id, title, filename, authors, year }: PaperCardProps) {
  const [coverFailed, setCoverFailed] = useState(false);
  const displayTitle = title && title.trim().length > 0 ? title : filename;
  const authorLine = formatAuthors(authors);

  return (
    <Link
      href={`/papers/${id}/read`}
      className="group block focus:outline-none"
      aria-label={displayTitle}
    >
      <Card className="gap-3 overflow-hidden rounded-md border-border/60 py-0 shadow-none transition-colors hover:border-border">
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
          {coverFailed ? (
            <div
              aria-hidden
              className="flex h-full w-full items-center justify-center text-muted-foreground"
            >
              <span className="text-[10px] uppercase tracking-[0.14em]">No cover</span>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/papers/${id}/cover`}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setCoverFailed(true)}
            />
          )}
        </div>
        <CardContent className="flex flex-col gap-1 px-3 pb-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 font-display text-sm leading-snug line-clamp-2">
              {displayTitle}
            </h3>
            {year != null && (
              <span className="shrink-0 rounded-sm border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {year}
              </span>
            )}
          </div>
          {authorLine && (
            <p className="text-xs text-muted-foreground line-clamp-1">{authorLine}</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
