"use client";

// G17 — /references view-mode toggle (grid <-> list).
// List view = enhanced shadcn Table with AI fill column.
// Grid view = simple compact card grid (like papers).
import { useEffect, useMemo, useState, useCallback } from "react";
import { LayoutGrid, List } from "lucide-react";
import Link from "next/link";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FolderBreadcrumbBadge } from "@/components/FolderBreadcrumbBadge";
import { Badge } from "@/components/ui/badge";
import { AiFillButton } from "@/components/AiFillButton";
import { AiFillBatchButton } from "@/components/AiFillBatchButton";
import { denormaliseForList, type CslItem } from "@/lib/csl";
import type { ReferenceRow } from "@/lib/references-server";
import type { FolderRow } from "@/lib/folders";

const STORAGE_KEY = "g17:references-view";
type View = "grid" | "list";

interface Props {
  rows: ReferenceRow[];
  folders?: FolderRow[];
}

interface DisplayRow {
  id: string;
  citationKey: string;
  title: string;
  authorsText: string;
  year: number | null;
  doi: string | null;
  venue: string;
  folderPath: string;
  folderId: string | null;
  missing: string[];
  known: Record<string, unknown>;
  cslJson: Record<string, unknown>;
}

function toDisplay(row: ReferenceRow): DisplayRow {
  const csl = (row.cslJson ?? { id: row.id, type: "article" }) as CslItem;
  const { title, authorsText, year, doi } = denormaliseForList(csl);
  const venue = (csl["container-title"] as string | undefined) ?? "";

  const missing: string[] = [];
  if (!title) missing.push("title");
  if (!authorsText) missing.push("authors");
  if (year == null) missing.push("year");
  if (!doi) missing.push("doi");
  if (!venue) missing.push("venue");

  const known: Record<string, unknown> = { citationKey: row.citationKey };
  if (title) known.title = title;
  if (authorsText) known.authors = authorsText;
  if (year != null) known.year = year;
  if (doi) known.doi = doi;
  if (venue) known.venue = venue;

  return {
    id: row.id,
    citationKey: row.citationKey,
    title,
    authorsText,
    year,
    doi,
    venue,
    folderPath: row.folderPath,
    folderId: row.folderId ?? null,
    missing,
    known,
    cslJson: csl as Record<string, unknown>,
  };
}

export function ReferencesView({ rows, folders }: Props) {
  const [view, setView] = useState<View>("list");
  const [fillingIds, setFillingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "list" || saved === "grid") setView(saved);
  }, []);

  function onChange(v: View) {
    setView(v);
    window.localStorage.setItem(STORAGE_KEY, v);
  }

  const display = useMemo(() => rows.map(toDisplay), [rows]);

  const handleFillStart = useCallback((rowId: string) => {
    setFillingIds((prev) => {
      const next = new Set(prev);
      next.add(rowId);
      return next;
    });
  }, []);

  const handleFillEnd = useCallback((rowId: string) => {
    setFillingIds((prev) => {
      const next = new Set(prev);
      next.delete(rowId);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        {view === "list" ? (
          <AiFillBatchButton
            kind="reference"
            rows={display.map((r) => ({
              id: r.id,
              patchUrl: `/api/references/${r.id}`,
              known: r.known,
              missing: r.missing,
              cslJson: r.cslJson,
            }))}
            onFillStart={handleFillStart}
            onFillEnd={handleFillEnd}
          />
        ) : null}
        <ToggleGroup
          value={[view]}
          onValueChange={(vals) => {
            const next = vals[0] as View | undefined;
            if (next) onChange(next);
          }}
          aria-label="References view mode"
        >
          <ToggleGroupItem
            value="grid"
            aria-label="Grid view"
            data-testid="refs-view-grid"
          >
            <LayoutGrid aria-hidden className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="list"
            aria-label="List view"
            data-testid="refs-view-list"
          >
            <List aria-hidden className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {view === "list" ? (
        <ReferencesListTable display={display} folders={folders} fillingIds={fillingIds} onFillStart={handleFillStart} onFillEnd={handleFillEnd} />
      ) : (
        <ReferencesGrid display={display} folders={folders} />
      )}
    </div>
  );
}

function ReferencesListTable({
  display,
  folders,
  fillingIds,
  onFillStart,
  onFillEnd,
}: {
  display: DisplayRow[];
  folders?: FolderRow[];
  fillingIds: Set<string>;
  onFillStart: (rowId: string) => void;
  onFillEnd: (rowId: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border/60">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Citation key</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Authors</TableHead>
            <TableHead className="text-right">Year</TableHead>
            <TableHead>DOI</TableHead>
            <TableHead>Venue</TableHead>
            <TableHead>Folder</TableHead>
            <TableHead className="w-10" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {display.map((r) => (
            <TableRow
              key={r.id}
              data-testid={`refs-row-${r.id}`}
              data-ai-filling={fillingIds.has(r.id) || undefined}
              className={fillingIds.has(r.id) ? "ai-filling" : undefined}
            >
              <TableCell className="font-mono text-xs">{r.citationKey}</TableCell>
              <TableCell className={`max-w-md${r.missing.includes("title") ? " bg-red-50 dark:bg-red-950/30" : ""}`}>
                <Link href={`/r/${r.id}`} className="line-clamp-2 hover:underline">
                  {r.title || <span className="text-muted-foreground">(untitled)</span>}
                </Link>
              </TableCell>
              <TableCell className={`text-muted-foreground${r.missing.includes("authors") ? " bg-red-50 dark:bg-red-950/30" : ""}`}>{r.authorsText}</TableCell>
              <TableCell className={`text-right tabular-nums text-muted-foreground${r.missing.includes("year") ? " bg-red-50 dark:bg-red-950/30" : ""}`}>
                {r.year ?? ""}
              </TableCell>
              <TableCell className={`font-mono text-xs text-muted-foreground${r.missing.includes("doi") ? " bg-red-50 dark:bg-red-950/30" : ""}`}>
                {r.doi ?? ""}
              </TableCell>
              <TableCell className={`text-muted-foreground${r.missing.includes("venue") ? " bg-red-50 dark:bg-red-950/30" : ""}`}>{r.venue}</TableCell>
              <TableCell>
                <FolderPill folders={folders} folderId={r.folderId} folderPath={r.folderPath} />
              </TableCell>
              <TableCell>
                <AiFillButton
                  patchUrl={`/api/references/${r.id}`}
                  kind="reference"
                  known={r.known}
                  missing={r.missing}
                  cslJson={r.cslJson}
                  ariaLabel={`Fill missing fields for ${r.citationKey}`}
                  onFillStart={() => onFillStart(r.id)}
                  onFillEnd={() => onFillEnd(r.id)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ReferencesGrid({
  display,
  folders,
}: {
  display: DisplayRow[];
  folders?: FolderRow[];
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {display.map((r) => (
        <Link
          key={r.id}
          href={`/r/${r.id}`}
          className="flex flex-col gap-1 rounded-md border border-border/60 p-3 hover:border-border"
        >
          <span className="font-mono text-xs text-muted-foreground">
            {r.citationKey}
          </span>
          <span className="line-clamp-3 font-medium">
            {r.title || "(untitled)"}
          </span>
          <span className="text-xs text-muted-foreground">
            {r.authorsText}
            {r.year != null ? ` · ${r.year}` : ""}
          </span>
          <FolderPill folders={folders} folderId={r.folderId} folderPath={r.folderPath} />
        </Link>
      ))}
    </div>
  );
}

function FolderPill({
  folders,
  folderId,
  folderPath,
}: {
  folders?: FolderRow[];
  folderId: string | null;
  folderPath: string;
}) {
  if (folders && folderId) {
    return <FolderBreadcrumbBadge folderId={folderId} folders={folders} />;
  }
  const label = folderPath ? folderPath.replace(/\/$/, "") : "/";
  return (
    <Badge variant="secondary" data-testid="folder-pill-fallback">
      {label}
    </Badge>
  );
}