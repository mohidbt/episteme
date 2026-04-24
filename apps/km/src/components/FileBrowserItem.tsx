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
import {
  FileBrowserContextMenu,
  type FileBrowserContextMenuHandlers,
} from "./FileBrowserContextMenu";

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
}

interface Props {
  item: FileBrowserItemData;
  view: "tile" | "list";
  index: number;
  selected: boolean;
  currentFolderId: string | null;
  isInTrash: boolean;
  onSelect: (
    id: string,
    ev: ReactMouseEvent<HTMLElement> | { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean },
  ) => void;
  onOpen: (item: FileBrowserItemData) => void;
  contextMenuHandlers: FileBrowserContextMenuHandlers;
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
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
  isInTrash,
  onSelect,
  onOpen,
  contextMenuHandlers,
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
    // Shift/meta click: multi-select only (suppress navigation).
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
      if (item.href != null) ev.preventDefault();
      ev.stopPropagation();
      onSelect(item.id, ev);
      return;
    }
    // Plain click: open.
    if (item.href != null) ev.preventDefault();
    ev.stopPropagation();
    onSelect(item.id, ev);
    onOpen(item);
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
      <FileBrowserContextMenu
        item={item}
        isInTrash={isInTrash}
        handlers={contextMenuHandlers}
        render={
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
          />
        }
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
          {formatUpdated(item.updatedAt)}
        </TableCell>
      </FileBrowserContextMenu>
    );
  }

  // Tile view.
  const tile = (
    <Card
      className={`tile-enter flex aspect-[4/3] w-full cursor-pointer flex-col gap-2 border-border bg-card p-3 transition-all duration-150 hover:-translate-y-px hover:shadow-sm ${
        isDragging ? "opacity-50" : ""
      } data-[selected=true]:ring-2 data-[selected=true]:ring-ring data-[over=true]:outline data-[over=true]:outline-2 data-[over=true]:outline-ring`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <Icon aria-hidden className="size-4 text-muted-foreground" />
      <div className="mt-auto flex flex-col gap-0.5">
        <div className="font-display line-clamp-2 text-sm leading-snug text-card-foreground">
          {item.title}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {formatUpdated(item.updatedAt)}
        </div>
      </div>
    </Card>
  );

  if (item.href != null) {
    return (
      <FileBrowserContextMenu
        item={item}
        isInTrash={isInTrash}
        handlers={contextMenuHandlers}
        render={
          <Link
            href={item.href}
            ref={setRef as (el: HTMLAnchorElement | null) => void}
            {...attributes}
            {...listeners}
            {...commonData}
            className="block outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
          />
        }
      >
        {tile}
      </FileBrowserContextMenu>
    );
  }

  return (
    <FileBrowserContextMenu
      item={item}
      isInTrash={isInTrash}
      handlers={contextMenuHandlers}
      render={
        <div
          ref={setRef as (el: HTMLDivElement | null) => void}
          {...attributes}
          {...listeners}
          {...commonData}
          role="button"
          tabIndex={0}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        />
      }
    >
      {tile}
    </FileBrowserContextMenu>
  );
}

export const FileBrowserItem = memo(
  FileBrowserItemImpl,
  (a, b) =>
    a.item.id === b.item.id &&
    a.view === b.view &&
    a.index === b.index &&
    a.selected === b.selected &&
    a.currentFolderId === b.currentFolderId &&
    a.isInTrash === b.isInTrash,
);
