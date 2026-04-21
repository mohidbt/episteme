"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { denormaliseForList, type CslItem } from "@/lib/csl";
import type { ReferenceRow } from "@/lib/references-server";
import { cn } from "@/lib/utils";

type SortKey = "citationKey" | "title" | "year";
type SortDir = "asc" | "desc";

interface ReferenceTableProps {
  rows: ReferenceRow[];
}

interface DisplayRow {
  id: string;
  citationKey: string;
  title: string;
  authorsText: string;
  year: number | null;
  folderPath: string;
}

function toDisplay(row: ReferenceRow): DisplayRow {
  const csl = (row.cslJson ?? { id: row.id, type: "article" }) as CslItem;
  const { title, authorsText, year } = denormaliseForList(csl);
  return {
    id: row.id,
    citationKey: row.citationKey,
    title,
    authorsText,
    year,
    folderPath: row.folderPath,
  };
}

function cmp<T>(a: T, b: T): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function ReferenceTable({ rows }: ReferenceTableProps) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const display = useMemo(() => rows.map(toDisplay), [rows]);

  const sorted = useMemo(() => {
    if (!sortKey) return display;
    const copy = [...display];
    copy.sort((a, b) => {
      const sign = sortDir === "asc" ? 1 : -1;
      return cmp(a[sortKey], b[sortKey]) * sign;
    });
    return copy;
  }, [display, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  async function onDelete(id: string, label: string) {
    if (!window.confirm(`Delete reference "${label}"?`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/references/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Delete failed", { description: `HTTP ${res.status}` });
        return;
      }
      toast.success("Deleted");
      router.refresh();
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border/60">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
            <SortHeader
              label="Citation key"
              active={sortKey === "citationKey"}
              dir={sortDir}
              onClick={() => toggleSort("citationKey")}
            />
            <SortHeader
              label="Title"
              active={sortKey === "title"}
              dir={sortDir}
              onClick={() => toggleSort("title")}
            />
            <th className="px-3 py-2 text-left font-medium">Authors</th>
            <SortHeader
              label="Year"
              active={sortKey === "year"}
              dir={sortDir}
              onClick={() => toggleSort("year")}
              align="right"
            />
            <th className="px-3 py-2 text-left font-medium">Folder</th>
            <th className="w-10 px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.id}
              className="border-b last:border-b-0 odd:bg-muted/30 hover:bg-muted/50"
            >
              <td className="px-3 py-2 font-mono text-xs">{r.citationKey}</td>
              <td className="max-w-md px-3 py-2">
                <Link
                  href={`/r/${r.id}`}
                  className="line-clamp-2 hover:underline"
                >
                  {r.title || <span className="text-muted-foreground">(untitled)</span>}
                </Link>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {r.authorsText}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {r.year ?? ""}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {r.folderPath || "/"}
              </td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  disabled={deletingId === r.id}
                  onClick={() => onDelete(r.id, r.citationKey)}
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
                    deletingId === r.id && "pointer-events-none opacity-50",
                  )}
                  aria-label={`Delete ${r.citationKey}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th className={cn("px-3 py-2 font-medium", align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground"
      >
        {label}
        {active && (dir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
      </button>
    </th>
  );
}
