"use client";

// G17 — /papers view-mode toggle (grid <-> list).
// Wraps the existing PaperGrid (unchanged) and a new PapersListTable.
// Persists choice in localStorage so it sticks across navigations.
import { useEffect, useState } from "react";
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
import { PaperGrid } from "@/components/PaperGrid";
import { FolderBreadcrumbBadge } from "@/components/FolderBreadcrumbBadge";
import { AiFillButton } from "@/components/AiFillButton";
import { AiFillBatchButton } from "@/components/AiFillBatchButton";
import type { PaperRow } from "@/lib/papers-server";
import type { FolderRow } from "@/lib/folders";

const STORAGE_KEY = "g17:papers-view";
type View = "grid" | "list";

interface Props {
  papers: PaperRow[];
  folders?: FolderRow[];
}

const PAPER_FILLABLE = ["title", "authors", "year", "doi", "venue"] as const;

function missingFor(p: PaperRow): string[] {
  const out: string[] = [];
  if (!p.title) out.push("title");
  if (!p.authors || p.authors.length === 0) out.push("authors");
  if (p.year == null) out.push("year");
  if (!p.doi) out.push("doi");
  if (!p.venue) out.push("venue");
  return out;
}

function knownFor(p: PaperRow): Record<string, unknown> {
  const k: Record<string, unknown> = { filename: p.filename };
  if (p.title) k.title = p.title;
  if (p.authors && p.authors.length) k.authors = p.authors;
  if (p.year != null) k.year = p.year;
  if (p.doi) k.doi = p.doi;
  if (p.venue) k.venue = p.venue;
  return k;
}

export function PapersView({ papers, folders }: Props) {
  const [view, setView] = useState<View>("grid");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "list" || saved === "grid") setView(saved);
  }, []);

  function onChange(v: View) {
    setView(v);
    window.localStorage.setItem(STORAGE_KEY, v);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        {view === "list" ? (
          <AiFillBatchButton
            kind="paper"
            rows={papers.map((p) => ({
              id: p.id,
              patchUrl: `/api/papers/${p.id}`,
              known: knownFor(p),
              missing: missingFor(p),
            }))}
          />
        ) : null}
        <ToggleGroup
          value={[view]}
          onValueChange={(vals) => {
            const next = vals[0] as View | undefined;
            if (next) onChange(next);
          }}
          aria-label="Papers view mode"
        >
          <ToggleGroupItem
            value="grid"
            aria-label="Grid view"
            data-testid="papers-view-grid"
          >
            <LayoutGrid aria-hidden className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="list"
            aria-label="List view"
            data-testid="papers-view-list"
          >
            <List aria-hidden className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {view === "grid" ? (
        <PaperGrid papers={papers} folders={folders} />
      ) : (
        <PapersListTable papers={papers} folders={folders} />
      )}
    </div>
  );
}

function PapersListTable({ papers, folders }: Props) {
  return (
    <div className="overflow-x-auto rounded-md border border-border/60">
      <Table>
        <TableHeader>
          <TableRow>
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
          {papers.map((p) => {
            const missing = missingFor(p);
            const authorsText =
              p.authors && p.authors.length
                ? p.authors.length > 2
                  ? `${p.authors[0]} et al.`
                  : p.authors.join(" & ")
                : "";
            return (
              <TableRow key={p.id} data-testid={`papers-row-${p.id}`}>
                <TableCell className="max-w-md">
                  <Link href={`/p/${p.id}`} className="line-clamp-2 hover:underline">
                    {p.title || (
                      <span className="text-muted-foreground">{p.filename}</span>
                    )}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{authorsText}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {p.year ?? ""}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {p.doi ?? ""}
                </TableCell>
                <TableCell className="text-muted-foreground">{p.venue ?? ""}</TableCell>
                <TableCell>
                  {folders && p.folderId ? (
                    <FolderBreadcrumbBadge folderId={p.folderId} folders={folders} />
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.folderPath || "/"}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <AiFillButton
                    patchUrl={`/api/papers/${p.id}`}
                    kind="paper"
                    known={knownFor(p)}
                    missing={missing}
                    ariaLabel={`Fill missing fields for ${p.title ?? p.filename}`}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export const PAPER_FILLABLE_FIELDS = PAPER_FILLABLE;
