"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { NoteRow } from "@/lib/notes-server";
import {
  resolveChain,
  breadcrumbFromChain,
  type FolderRow,
} from "@/lib/folders";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SortKey = "title" | "folderName" | "updatedAt";

function SortHeader({
  label,
  column,
  sortKey,
  sortDir,
  onClick,
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onClick: (key: SortKey) => void;
}) {
  const active = sortKey === column;
  return (
    <button
      type="button"
      onClick={() => onClick(column)}
      className="inline-flex items-center gap-1 text-left font-medium hover:text-foreground"
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span>{label}</span>
      <span className="inline-flex size-3 items-center justify-center">
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp className="size-3" aria-hidden />
          ) : (
            <ChevronDown className="size-3" aria-hidden />
          )
        ) : (
          <ChevronUp className="size-3 opacity-0" aria-hidden />
        )}
      </span>
    </button>
  );
}

export default function NotesTable({
  notes,
  folderById,
}: {
  notes: NoteRow[];
  folderById: Map<string, FolderRow>;
}) {
  const allFolders = useMemo(() => Array.from(folderById.values()), [folderById]);

  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const rows = useMemo(() => {
    return notes.map((note) => {
      const chain = resolveChain(allFolders, note.folderId);
      const crumb = breadcrumbFromChain(chain);
      return {
        note,
        crumb,
        folderName: crumb ?? "",
        updatedAtMs: new Date(note.updatedAt).getTime(),
      };
    });
  }, [notes, allFolders]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "title") {
        cmp = a.note.title.localeCompare(b.note.title, undefined, {
          sensitivity: "base",
        });
      } else if (sortKey === "folderName") {
        cmp = a.folderName.localeCompare(b.folderName, undefined, {
          sensitivity: "base",
        });
      } else {
        cmp = a.updatedAtMs - b.updatedAtMs;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return key;
    });
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <SortHeader
              label="Title"
              column="title"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={toggleSort}
            />
          </TableHead>
          <TableHead>
            <SortHeader
              label="Folder"
              column="folderName"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={toggleSort}
            />
          </TableHead>
          <TableHead>
            <SortHeader
              label="Updated"
              column="updatedAt"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={toggleSort}
            />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map(({ note, crumb }) => (
          <TableRow key={note.id}>
            <TableCell>
              <Link
                href={`/n/${note.slug}`}
                className="text-foreground hover:underline"
              >
                {note.title}
              </Link>
            </TableCell>
            <TableCell>
              {crumb ? (
                <Badge variant="secondary">{crumb}</Badge>
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">
              {new Date(note.updatedAt).toLocaleDateString("en-US")}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
