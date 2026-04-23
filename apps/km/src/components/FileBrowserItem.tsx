"use client";

import { memo } from "react";
import Link from "next/link";
import {
  Folder,
  FileText,
  BookMarked,
  NotebookPen,
  Table as TableIcon,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export type ItemKind = "folder" | "paper" | "reference" | "note" | "data";

export const KIND_ICON: Record<ItemKind, LucideIcon> = {
  folder: Folder,
  paper: FileText,
  reference: BookMarked,
  note: NotebookPen,
  data: TableIcon,
};

const KIND_LABEL: Record<ItemKind, string> = {
  folder: "Folder",
  paper: "Paper",
  reference: "Reference",
  note: "Note",
  data: "Data",
};

export interface FileBrowserItemData {
  id: string;
  kind: ItemKind;
  title: string;
  // serializable timestamp (ms) across RSC boundary
  updatedAt: number;
  // for leaves: link href; folders have no href (onOpen is used instead)
  href: string | null;
  // optional folder name breadcrumb shown in list view
  folderName?: string | null;
}

interface Props {
  item: FileBrowserItemData;
  view: "tile" | "list";
  index: number;
  onOpen: (item: FileBrowserItemData) => void;
  // TODO(T17): selection hook
  // TODO(T19): right-click context menu
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatUpdated(ms: number): string {
  return DATE_FMT.format(new Date(ms));
}

function FileBrowserItemImpl({ item, view, index, onOpen }: Props) {
  const Icon = KIND_ICON[item.kind];
  const delayMs = Math.min(index * 30, 600);

  if (view === "list") {
    const clickProps =
      item.href != null
        ? { as: Link, href: item.href }
        : {
            onClick: () => onOpen(item),
            role: "button" as const,
            tabIndex: 0,
          };
    return (
      <TableRow
        data-testid={`fb-item-${item.id}`}
        className="cursor-pointer"
        {...(clickProps as object)}
      >
        <TableCell className="flex items-center gap-2 font-medium">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
          {item.href != null ? (
            <Link href={item.href} className="hover:underline">
              {item.title}
            </Link>
          ) : (
            <button
              type="button"
              className="text-left hover:underline"
              onClick={() => onOpen(item)}
            >
              {item.title}
            </button>
          )}
        </TableCell>
        <TableCell>
          <Badge variant="secondary">{KIND_LABEL[item.kind]}</Badge>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {item.folderName ?? "—"}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {formatUpdated(item.updatedAt)}
        </TableCell>
      </TableRow>
    );
  }

  const tile = (
    <Card
      data-testid={`fb-item-${item.id}`}
      className="tile-enter flex size-[180px] cursor-pointer flex-col justify-between gap-2 border-border bg-card p-4 transition-all duration-150 hover:-translate-y-px hover:shadow-sm"
      style={{ animationDelay: `${delayMs}ms` }}
      onClick={item.href == null ? () => onOpen(item) : undefined}
    >
      <Icon
        aria-hidden
        className="size-8 text-muted-foreground"
      />
      <div className="flex flex-col gap-0.5">
        <div className="font-display line-clamp-2 text-sm text-card-foreground">
          {item.title}
        </div>
        <div className="text-xs text-muted-foreground">
          {formatUpdated(item.updatedAt)}
        </div>
      </div>
    </Card>
  );

  if (item.href != null) {
    return (
      <Link
        href={item.href}
        data-testid={`fb-item-${item.id}`}
        className="block outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card
          className="tile-enter flex size-[180px] cursor-pointer flex-col justify-between gap-2 border-border bg-card p-4 transition-all duration-150 hover:-translate-y-px hover:shadow-sm"
          style={{ animationDelay: `${delayMs}ms` }}
        >
          <Icon aria-hidden className="size-8 text-muted-foreground" />
          <div className="flex flex-col gap-0.5">
            <div className="font-display line-clamp-2 text-sm text-card-foreground">
              {item.title}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatUpdated(item.updatedAt)}
            </div>
          </div>
        </Card>
      </Link>
    );
  }

  return tile;
}

export const FileBrowserItem = memo(
  FileBrowserItemImpl,
  (a, b) => a.item.id === b.item.id && a.view === b.view && a.index === b.index,
);
