"use client";

import Link from "next/link";
import { Database } from "lucide-react";
import { resolveChain, breadcrumbFromChain, type FolderRow } from "@/lib/folders";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PapersetTableRow {
  id: string;
  filename: string;
  folderId: string | null;
  columns: Array<{ name: string; description: string }>;
  rowRefs: Array<{ paper_id: string }>;
  updatedAt: Date | string | number;
}

export function PapersetTable({
  rows,
  folders,
}: {
  rows: PapersetTableRow[];
  folders: FolderRow[];
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        No papersets yet. Create one from Drive.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Filename</TableHead>
          <TableHead>Folder</TableHead>
          <TableHead>Columns</TableHead>
          <TableHead>Rows</TableHead>
          <TableHead>Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const chain = resolveChain(folders, r.folderId);
          const crumb = breadcrumbFromChain(chain);
          return (
            <TableRow key={r.id}>
              <TableCell>
                <Link
                  href={`/d/${r.id}`}
                  className="inline-flex items-center gap-2 text-foreground hover:underline"
                >
                  <Database className="size-4 text-muted-foreground" aria-hidden />
                  {r.filename}
                </Link>
              </TableCell>
              <TableCell>
                {crumb ? (
                  <Badge variant="secondary">{crumb}</Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </TableCell>
              <TableCell>{r.columns.length}</TableCell>
              <TableCell>{r.rowRefs.length}</TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {new Date(r.updatedAt).toLocaleDateString("en-US")}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
