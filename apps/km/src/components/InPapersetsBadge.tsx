"use client";

import Link from "next/link";
import { Sheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface PapersetItem {
  id: string;
  filename: string;
}

export function InPapersetsBadge({
  count,
  papersets,
  className,
}: {
  count: number;
  papersets: PapersetItem[];
  className?: string;
}) {
  if (count === 0) return null;
  const label = `in ${count} ${count === 1 ? "paperset" : "papersets"}`;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={label}
            data-testid="in-papersets-badge"
            className={className}
          >
            <Sheet aria-hidden />
            <span>{label}</span>
          </Button>
        }
      />
      <PopoverContent align="end" className="w-64 p-2">
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
