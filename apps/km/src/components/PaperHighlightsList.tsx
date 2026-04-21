"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { paperHighlights } from "@episteme/db/schema";
import { Button } from "@/components/ui/button";

type HighlightRow = typeof paperHighlights.$inferSelect;

interface PaperHighlightsListProps {
  paperId: string;
}

export function PaperHighlightsList({ paperId }: PaperHighlightsListProps) {
  const [rows, setRows] = useState<HighlightRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/paper-highlights?paperId=${encodeURIComponent(paperId)}`,
        );
        if (!res.ok) {
          if (!cancelled) setError(`HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as HighlightRow[];
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  async function onDelete(id: string) {
    const prev = rows ?? [];
    setRows(prev.filter((r) => r.id !== id));
    try {
      const res = await fetch(`/api/paper-highlights/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setRows(prev);
        toast.error("Failed to delete highlight", { description: `HTTP ${res.status}` });
      }
    } catch (e) {
      setRows(prev);
      toast.error("Failed to delete highlight", { description: (e as Error).message });
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <p className="text-[11px] tracking-[0.14em] uppercase text-muted-foreground">
        Highlights
      </p>
      {error ? (
        <p className="text-sm text-muted-foreground">Couldn&rsquo;t load highlights.</p>
      ) : rows === null ? (
        <p className="text-sm text-muted-foreground">Loading&hellip;</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No highlights yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((h) => (
            <li
              key={h.id}
              className="flex items-start gap-3 rounded-md border border-border/60 p-3"
            >
              <span className="mt-0.5 shrink-0 rounded-sm border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                p.{h.page}
              </span>
              <div className="min-w-0 flex-1">
                {h.noteMd && h.noteMd.trim().length > 0 ? (
                  <p className="text-sm leading-snug whitespace-pre-wrap">{h.noteMd}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Untitled highlight</p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onDelete(h.id)}
                aria-label="Delete highlight"
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
