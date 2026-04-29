"use client";

import Link from "next/link";
import { Sheet } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface PapersetItem {
  id: string;
  filename: string;
}

export function InPapersetsBadge({
  count,
  papersets,
}: {
  count: number;
  papersets: PapersetItem[];
}) {
  if (count === 0) return null;
  const label = `in ${count} ${count === 1 ? "paperset" : "papersets"}`;
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={label}
        className="mb-2 inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
      >
        <Sheet className="h-3 w-3" aria-hidden />
        <span>{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
          Papersets containing this paper
        </p>
        <ul className="space-y-0.5 text-sm">
          {papersets.map((p) => (
            <li key={p.id}>
              <Link
                href={`/d/${p.id}`}
                className="block rounded px-2 py-1 hover:bg-muted"
              >
                {p.filename}
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
