"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export type CitationPillSource =
  | {
      sourceKind: "paper";
      sourceId: string;
      page?: number | null;
      highlight?: string | null;
      title?: string | null;
    }
  | {
      sourceKind: "note";
      sourceId: string;
      slug?: string | null;
      heading?: string | null;
      title?: string | null;
    };

export function CitationPill({ source }: { source: CitationPillSource }) {
  if (source.sourceKind === "paper") {
    const page = source.page && source.page > 0 ? source.page : 1;
    const hl = source.highlight ? `&hl=${encodeURIComponent(source.highlight)}` : "";
    const href = `/p/${source.sourceId}?p=${page}${hl}`;
    const label = source.title?.trim() || `Paper p.${page}`;
    return (
      <Badge
        variant="secondary"
        render={
          <Link href={href} aria-label={`Open paper citation: ${label}`} title={label} />
        }
      >
        {label}
      </Badge>
    );
  }

  const slug = source.slug?.trim() || source.sourceId;
  if (!slug) {
    return (
      <Badge variant="secondary" aria-label="Missing citation source" title="Missing citation source">
        Unknown source
      </Badge>
    );
  }
  const anchor = source.heading ? `#${encodeURIComponent(source.heading)}` : "";
  const href = `/n/${slug}${anchor}`;
  const label = source.title?.trim() || "Note";
  return (
    <Badge
      variant="secondary"
      render={
        <Link href={href} aria-label={`Open note citation: ${label}`} title={label} />
      }
    >
      {label}
    </Badge>
  );
}
