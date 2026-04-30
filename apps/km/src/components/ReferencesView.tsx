"use client";

// G17 — /references view-mode toggle (grid <-> list).
// List view = enhanced shadcn Table with AI fill column.
// Grid view = simple compact card grid (like papers).
import { useEffect, useMemo, useState } from "react";
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
  };
}

export function ReferencesView({ rows, folders }: Props) {
  const [view, setView] = useState<View>("list");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "list" || saved === "grid") setView(saved);
  }, []);

  function onChange(v: View) {
    setView(v);
    window.localStorage.setItem(STORAGE_KEY, v);
  }

  const display = useMemo(() => rows.map(toDisplay), [rows]);

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
            }))}
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
        <ReferencesListTable display={display} folders={folders} />
      ) : (
        <ReferencesGrid display={display} folders={folders} />
      )}
    </div>
  );
}

function ReferencesListTable({
  display,
  folders,
}: {
  display: DisplayRow[];
  folders?: FolderRow[];
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
            <TableRow key={r.id} data-testid={`refs-row-${r.id}`}>
              <TableCell className="font-mono text-xs">{r.citationKey}</TableCell>
              <TableCell className="max-w-md">
                <Link href={`/r/${r.id}`} className="line-clamp-2 hover:underline">
                  {r.title || <span className="text-muted-foreground">(untitled)</span>}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{r.authorsText}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {r.year ?? ""}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {r.doi ?? ""}
              </TableCell>
              <TableCell className="text-muted-foreground">{r.venue}</TableCell>
              <TableCell>
                {folders && r.folderId ? (
                  <FolderBreadcrumbBadge folderId={r.folderId} folders={folders} />
                ) : (
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.folderPath || "/"}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <AiFillButton
                  patchUrl={`/api/references/${r.id}`}
                  kind="reference"
                  known={r.known}
                  missing={r.missing}
                  ariaLabel={`Fill missing fields for ${r.citationKey}`}
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
          {folders && r.folderId ? (
            <FolderBreadcrumbBadge folderId={r.folderId} folders={folders} />
          ) : null}
        </Link>
      ))}
    </div>
  );
}
