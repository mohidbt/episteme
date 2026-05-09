"use client";

import { memo, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import {
  Folder,
  FileText,
  BookMarked,
  NotebookPen,
  Table as TableIcon,
  Sheet,
  Database,
  File as FileIcon,
  type LucideIcon,
} from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { FbDragActive, FbDragOver } from "./FileBrowser";
import {
  FileBrowserContextMenu,
  type FileBrowserContextMenuHandlers,
} from "./FileBrowserContextMenu";

export type ItemKind = "folder" | "paper" | "reference" | "note" | "data" | "asset" | "paperset";

export const KIND_ICON: Record<ItemKind, LucideIcon> = {
  folder: Folder,
  paper: FileText,
  reference: BookMarked,
  note: NotebookPen,
  data: TableIcon,
  asset: FileIcon,
  paperset: Database,
};

/**
 * Image-asset thumbnail. Fetches the presigned downloadUrl from
 * /api/assets/:id once on mount; falls back to a generic file icon while
 * loading or on error. We don't preload all assets globally — let each
 * tile pull its own URL lazily.
 */
function AssetImageThumb({ id, alt }: { id: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/assets/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((body: { downloadUrl?: string }) => {
        if (!cancelled && body.downloadUrl) setUrl(body.downloadUrl);
      })
      .catch(() => {
        /* silent — tile falls back to generic glyph */
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (!url) {
    return (
      <FileIcon
        aria-hidden
        data-testid="kind-icon-asset"
        className="h-16 w-16 text-muted-foreground/70"
        strokeWidth={1.5}
      />
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      data-testid="asset-thumb"
      className="h-16 w-16 rounded-sm object-cover ring-1 ring-border"
    />
  );
}

// Finder-style large glyph for tile view. Per-kind color and shape.
function KindGlyph({ kind, item }: { kind: ItemKind; item?: FileBrowserItemData }) {
  if (kind === "folder") {
    // Inline folder with a tab — filled apple-blue translucent body.
    return (
      <svg
        aria-hidden
        viewBox="0 -6 64 64"
        className="h-16 w-16"
        data-testid="kind-icon-folder"
        fill="none"
      >
        <path
          d="M4 12a4 4 0 0 1 4-4h15l5 5h28a4 4 0 0 1 4 4v27a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V12Z"
          className="fill-blue-400/30 stroke-blue-500/70"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === "paper") {
    // Document with a folded dog-ear corner.
    return (
      <svg
        aria-hidden
        viewBox="-8 -2 64 64"
        className="h-16 w-16"
        data-testid="kind-icon-paper"
        fill="none"
      >
        <path
          d="M6 4h24l12 12v36a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z"
          className="fill-rose-500/10 stroke-rose-500/70"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        <path
          d="M30 4v10a2 2 0 0 0 2 2h10"
          className="stroke-rose-500/70"
          strokeWidth={1.5}
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M14 32h20M14 40h20M14 48h14"
          className="stroke-rose-500/50"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === "reference") {
    return (
      <BookMarked
        aria-hidden
        data-testid="kind-icon-reference"
        className="h-16 w-16 text-amber-600/80"
        strokeWidth={1.5}
      />
    );
  }
  if (kind === "note") {
    return (
      <NotebookPen
        aria-hidden
        data-testid="kind-icon-note"
        className="h-16 w-16 text-emerald-600/70"
        strokeWidth={1.5}
      />
    );
  }
  if (kind === "paperset") {
    return (
      <Database
        aria-hidden
        data-testid="kind-icon-paperset"
        className="h-16 w-16 text-sky-600/80"
        strokeWidth={1.5}
      />
    );
  }
  if (kind === "asset") {
    if (item && item.mimeType && IMAGE_MIMES.has(item.mimeType)) {
      return <AssetImageThumb id={item.id} alt={item.title} />;
    }
    return (
      <FileIcon
        aria-hidden
        data-testid="kind-icon-asset"
        className="h-16 w-16 text-muted-foreground/70"
        strokeWidth={1.5}
      />
    );
  }
  // data
  return (
    <Sheet
      aria-hidden
      data-testid="kind-icon-data"
      className="h-16 w-16 text-green-600/80"
      strokeWidth={1.5}
    />
  );
}

const KIND_LABEL: Record<ItemKind, string> = {
  folder: "Folder",
  paper: "Paper",
  reference: "Reference",
  note: "Note",
  data: "Data",
  asset: "Asset",
  paperset: "Paperset",
};

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

export interface FileBrowserItemData {
  id: string;
  kind: ItemKind;
  title: string;
  // serializable timestamp (ms) across RSC boundary
  updatedAt: number;
  // for leaves: link href; folders have no href (onOpen is used instead)
  href: string | null;
  /** Asset only: MIME type — drives thumbnail vs generic-icon rendering. */
  mimeType?: string;
}

interface Props {
  item: FileBrowserItemData;
  view: "tile" | "list";
  index: number;
  selected: boolean;
  /** Full selection set — used to compose a batch drag payload. */
  selectedIds: Set<string>;
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
  selectedIds,
  currentFolderId,
  isInTrash,
  onSelect,
  onOpen,
  contextMenuHandlers,
}: Props) {
  const Icon = KIND_ICON[item.kind];
  const delayMs = Math.min(index * 30, 600);

  // Drag payload. If this item is part of a multi-selection, attach the full
  // id list so onDragEnd can issue a batch move.
  const isFolder = item.kind === "folder";
  const batchIds =
    selected && selectedIds.size > 1 ? Array.from(selectedIds) : undefined;
  const dragData: FbDragActive = isFolder
    ? {
        kind: "folder",
        id: item.id,
        title: item.title,
        currentFolderId,
        ids: batchIds,
      }
    : {
        kind: "leaf",
        itemKind: item.kind,
        id: item.id,
        title: item.title,
        currentFolderId,
        ids: batchIds,
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
    // Cmd/Ctrl click on a leaf with an href: let the browser open the link in
    // a new tab natively. Don't preventDefault, don't multi-select, don't
    // navigate via the router.
    if ((ev.metaKey || ev.ctrlKey) && item.href != null) {
      ev.stopPropagation();
      return;
    }
    // Shift click (and meta click on rows without an href, e.g. folders):
    // multi-select only — suppress navigation.
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
        <TableCell className="flex min-w-0 items-center gap-2 font-medium">
          {/*
           * List-view icons are normalized to a single 16px lucide glyph with
           * fixed stroke and `shrink-0` so flex layout never compresses them.
           * Without `size={16}` lucide falls back to its default 24 attribute
           * which can win over the Tailwind class on some browsers.
           */}
          <Icon
            aria-hidden
            size={16}
            strokeWidth={2}
            className="size-4 shrink-0 text-muted-foreground"
          />
          {item.href != null ? (
            <Link
              href={item.href}
              className="min-w-0 truncate hover:underline"
              onClick={(e) => {
                // Allow native cmd/ctrl-click to open in a new tab. For plain
                // clicks, suppress default — the row's onClick handles open
                // (and selection).
                if (e.metaKey || e.ctrlKey) return;
                e.preventDefault();
              }}
              tabIndex={-1}
            >
              {item.title}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-left">{item.title}</span>
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

  // Tile view — Finder-style: large glyph, title, date. No Card wrapper.
  const tileClass = `tile-enter group/tile flex w-full cursor-pointer flex-col items-center gap-2 rounded-md p-2 outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
    isDragging ? "opacity-50" : ""
  } data-[selected=true]:bg-accent/50 data-[over=true]:bg-accent/70 data-[over=true]:outline data-[over=true]:outline-2 data-[over=true]:outline-ring`;

  const tileInner = (
    <>
      <div className="flex h-20 items-center justify-center transition-transform duration-150 group-hover/tile:-translate-y-0.5 group-hover/tile:drop-shadow-sm">
        <KindGlyph kind={item.kind} item={item} />
      </div>
      <div className="flex w-full flex-col items-center gap-0.5">
        <div className="font-display line-clamp-2 w-full text-center text-sm leading-snug text-foreground">
          {item.title}
        </div>
        <div className="text-center text-[11px] text-muted-foreground">
          {formatUpdated(item.updatedAt)}
        </div>
      </div>
    </>
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
            className={tileClass}
            style={{ animationDelay: `${delayMs}ms` }}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
          />
        }
      >
        {tileInner}
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
          className={tileClass}
          style={{ animationDelay: `${delayMs}ms` }}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        />
      }
    >
      {tileInner}
    </FileBrowserContextMenu>
  );
}

export const FileBrowserItem = memo(
  FileBrowserItemImpl,
  (a, b) =>
    a.item.id === b.item.id &&
    a.item.title === b.item.title &&
    a.item.updatedAt === b.item.updatedAt &&
    a.view === b.view &&
    a.index === b.index &&
    a.selected === b.selected &&
    a.selectedIds === b.selectedIds &&
    a.currentFolderId === b.currentFolderId &&
    a.isInTrash === b.isInTrash,
);
