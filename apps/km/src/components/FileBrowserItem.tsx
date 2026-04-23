"use client";

import { memo, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import {
  Folder,
  FileText,
  BookMarked,
  NotebookPen,
  Table as TableIcon,
  type LucideIcon,
} from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Card } from "@/components/ui/card";
import { TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { FbDragActive, FbDragOver } from "./FileBrowser";

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
  selected: boolean;
  currentFolderId: string | null;
  onSelect: (
    id: string,
    ev: ReactMouseEvent<HTMLElement> | { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean },
  ) => void;
  onOpen: (item: FileBrowserItemData) => void;
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

function FileBrowserItemImpl({
  item,
  view,
  index,
  selected,
  currentFolderId,
  onSelect,
  onOpen,
}: Props) {
  const Icon = KIND_ICON[item.kind];
  const delayMs = Math.min(index * 30, 600);

  // Drag payload.
  const isFolder = item.kind === "folder";
  const dragData: FbDragActive = isFolder
    ? {
        kind: "folder",
        id: item.id,
        title: item.title,
        currentFolderId,
      }
    : {
        kind: "leaf",
        itemKind: item.kind,
        id: item.id,
        title: item.title,
        currentFolderId,
      };
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: `fb-drag:${item.id}`, data: dragData });

  // Only folders are droppable.
  const dropData: FbDragOver = { kind: "folder", id: item.id };
  const {
    setNodeRef: setDropRef,
    isOver,
  } = useDroppable({
    id: `fb-drop:${item.id}`,
    data: dropData,
    disabled: !isFolder,
  });

  const setRef = (el: HTMLElement | null) => {
    setDragRef(el);
    if (isFolder) setDropRef(el);
  };

  const handleClick = (ev: ReactMouseEvent<HTMLElement>) => {
    // Selection click: always intercept. If a link is wrapping, also prevent
    // navigation so single-click just selects; Enter / double-click navigates.
    if (item.href != null) ev.preventDefault();
    ev.stopPropagation();
    onSelect(item.id, ev);
  };

  const handleDoubleClick = (ev: ReactMouseEvent<HTMLElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    onOpen(item);
  };

  const commonData = {
    "data-testid": `fb-item-${item.id}`,
    "data-selected": selected ? "true" : undefined,
    "data-over": isFolder && isOver ? "true" : undefined,
  };

  if (view === "list") {
    return (
      <TableRow
        ref={setRef as (el: HTMLTableRowElement | null) => void}
        {...attributes}
        {...listeners}
        {...commonData}
        className={`cursor-pointer ${
          isDragging ? "opacity-50" : ""
        } data-[selected=true]:bg-accent/60 data-[over=true]:outline data-[over=true]:outline-2 data-[over=true]:outline-ring`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <TableCell className="flex items-center gap-2 font-medium">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
          {item.href != null ? (
            <Link
              href={item.href}
              className="hover:underline"
              onClick={(e) => e.preventDefault()}
              tabIndex={-1}
            >
              {item.title}
            </Link>
          ) : (
            <span className="text-left">{item.title}</span>
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

  // Tile view.
  const tile = (
    <Card
      className={`tile-enter flex size-[180px] cursor-pointer flex-col justify-between gap-2 border-border bg-card p-4 transition-all duration-150 hover:-translate-y-px hover:shadow-sm ${
        isDragging ? "opacity-50" : ""
      } data-[selected=true]:ring-2 data-[selected=true]:ring-ring data-[over=true]:outline data-[over=true]:outline-2 data-[over=true]:outline-ring`}
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
  );

  if (item.href != null) {
    return (
      <Link
        href={item.href}
        ref={setRef as (el: HTMLAnchorElement | null) => void}
        {...attributes}
        {...listeners}
        {...commonData}
        className="block outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {tile}
      </Link>
    );
  }

  return (
    <div
      ref={setRef as (el: HTMLDivElement | null) => void}
      {...attributes}
      {...listeners}
      {...commonData}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {tile}
    </div>
  );
}

export const FileBrowserItem = memo(
  FileBrowserItemImpl,
  (a, b) =>
    a.item.id === b.item.id &&
    a.view === b.view &&
    a.index === b.index &&
    a.selected === b.selected &&
    a.currentFolderId === b.currentFolderId,
);
