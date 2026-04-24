"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewItemTrigger } from "@/components/NewItemTrigger";
import {
  FileBrowserItem,
  type FileBrowserItemData,
  type ItemKind,
} from "@/components/FileBrowserItem";
import {
  FileBrowserToolbar,
  type ViewMode,
} from "@/components/FileBrowserToolbar";
import { MoveToDialog } from "@/components/MoveToDialog";
import type { FileBrowserContextMenuHandlers } from "@/components/FileBrowserContextMenu";
import type { FolderContents } from "@/lib/folders-server";
import { isDescendantOf, type FolderRow } from "@/lib/folders";

interface Props {
  libraryId: number;
  libraryName: string;
  folderId: string | null;
  folderChain: { id: string; name: string }[];
  contents: FolderContents;
  /**
   * Full folder list (id/parentId/name/isTrash) scoped to the current library,
   * needed for cycle-check when dragging a folder onto another folder.
   */
  folders: FolderRow[];
  /** True when the current folder is the Trash folder (T20). */
  isTrashView?: boolean;
  /** Optional override for empty-trash handler (for tests). Default: internal handler. */
  onEmptyTrash?: () => void;
}

/**
 * Drag payloads. Exported for tests + FileBrowserItem consumers.
 */
export interface FbDragActive {
  kind: "leaf" | "folder";
  itemKind?: ItemKind;
  id: string;
  title?: string;
  currentFolderId: string | null;
}
export interface FbDragOver {
  kind: "folder";
  id: string;
}

function toMs(v: Date | number | string): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return new Date(v).getTime();
  return v.getTime();
}

function flatten(contents: FolderContents): FileBrowserItemData[] {
  const folders: FileBrowserItemData[] = contents.folders
    .filter((f) => !f.isTrash)
    .map((f) => ({
      id: f.id,
      kind: "folder" as ItemKind,
      title: f.name,
      updatedAt: toMs(f.updatedAt),
      href: null,
    }));
  const papers: FileBrowserItemData[] = contents.papers.map((p) => ({
    id: p.id,
    kind: "paper" as ItemKind,
    title: p.title ?? "Untitled paper",
    updatedAt: toMs(p.updatedAt),
    href: `/p/${p.id}`,
  }));
  const refs: FileBrowserItemData[] = contents.references.map((r) => ({
    id: r.id,
    kind: "reference" as ItemKind,
    title: r.title,
    updatedAt: toMs(r.updatedAt),
    href: `/r/${r.id}`,
  }));
  const notes: FileBrowserItemData[] = contents.notes.map((n) => ({
    id: n.id,
    kind: "note" as ItemKind,
    title: n.title,
    updatedAt: toMs(n.updatedAt),
    href: `/n/${n.slug}`,
  }));
  return [...folders, ...papers, ...refs, ...notes];
}

function apiRouteForKind(kind: ItemKind): string | null {
  if (kind === "paper") return "papers";
  if (kind === "reference") return "references";
  if (kind === "note") return "notes";
  return null;
}

/**
 * Pure drop resolver — exported for unit tests. Performs the fetch
 * corresponding to a drag payload, applies the cycle guard, and emits toasts
 * on failure. Does not refresh the router itself; the caller should do that
 * on resolve.
 */
export async function resolveDrop(
  active: FbDragActive,
  over: FbDragOver,
  folders: FolderRow[],
): Promise<boolean> {
  if (active.kind === "leaf") {
    if (!active.itemKind) return false;
    const route = apiRouteForKind(active.itemKind);
    if (!route) return false;
    // No-op if already in that folder.
    if ((active.currentFolderId ?? null) === over.id) return false;
    try {
      const res = await fetch(`/api/${route}/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: over.id }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      return true;
    } catch (err) {
      toast.error(`Failed to move ${active.title ?? active.itemKind}`);
      console.error(err);
      return false;
    }
  }

  // Folder → folder.
  if (active.id === over.id) return false;
  if (isDescendantOf(folders, active.id, over.id)) {
    toast.error("Cannot move folder into itself");
    return false;
  }
  try {
    const res = await fetch("/api/folders/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: active.id, targetParentId: over.id }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return true;
  } catch (err) {
    toast.error("Failed to move folder");
    console.error(err);
    return false;
  }
}

type SortKey = "title" | "kind" | "updatedAt";

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

export function FileBrowser({
  libraryId,
  libraryName,
  folderId,
  folderChain,
  contents,
  folders,
  isTrashView = false,
  onEmptyTrash: onEmptyTrashProp,
}: Props) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("tile");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("km:fb:view");
      if (stored === "tile" || stored === "list") setView(stored);
    } catch {
      /* SSR / disabled storage */
    }
  }, []);
  const setViewPersist = useCallback((v: ViewMode) => {
    setView(v);
    try {
      localStorage.setItem("km:fb:view", v);
    } catch {
      /* no-op */
    }
  }, []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);

  // ── Rename dialog ─────────────────────────────────────────────────────────
  const [renameTarget, setRenameTarget] = useState<FileBrowserItemData | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // ── MoveToDialog ──────────────────────────────────────────────────────────
  const [moveTarget, setMoveTarget] = useState<FileBrowserItemData | null>(null);

  const items = useMemo(() => flatten(contents), [contents]);

  // ── List-view sort ───────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<"title" | "kind" | "updatedAt">("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sortedItems = useMemo(() => {
    const kindOrder: Record<ItemKind, number> = {
      folder: 0,
      paper: 1,
      reference: 2,
      note: 3,
      data: 4,
    };
    const copy = [...items];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "title") {
        cmp = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      } else if (sortKey === "kind") {
        cmp = kindOrder[a.kind] - kindOrder[b.kind];
      } else {
        cmp = a.updatedAt - b.updatedAt;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [items, sortKey, sortDir]);

  const displayItems = view === "list" ? sortedItems : items;

  const toggleSort = useCallback((key: "title" | "kind" | "updatedAt") => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  const itemsById = useMemo(() => {
    const map = new Map<string, FileBrowserItemData>();
    for (const i of displayItems) map.set(i.id, i);
    return map;
  }, [displayItems]);
  const orderedIds = useMemo(() => displayItems.map((i) => i.id), [displayItems]);

  const handleOpen = useCallback(
    (item: FileBrowserItemData) => {
      if (item.kind === "folder") {
        const segments = [
          ...folderChain.map((c) => c.name),
          item.title,
        ].map(encodeURIComponent);
        router.push(`/drive/${segments.join("/")}`);
        return;
      }
      if (item.href) router.push(item.href);
    },
    [router, folderChain],
  );

  const onMutate = useCallback(() => router.refresh(), [router]);

  // ── Context-menu handler implementations ─────────────────────────────────

  const handleRename = useCallback((item: FileBrowserItemData) => {
    setRenameTarget(item);
    setRenameDraft(item.title);
  }, []);

  const handleRenameSave = useCallback(async () => {
    if (!renameTarget) return;
    const name = renameDraft.trim();
    if (!name) return;
    const kind = renameTarget.kind;
    const id = renameTarget.id;
    const body = kind === "folder" ? { name } : { title: name };
    const route =
      kind === "folder"
        ? `folders/${id}`
        : kind === "paper"
          ? `papers/${id}`
          : kind === "reference"
            ? `references/${id}`
            : `notes/${id}`;
    try {
      const res = await fetch(`/api/${route}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setRenameTarget(null);
      router.refresh();
    } catch {
      toast.error("Failed to rename");
    }
  }, [renameTarget, renameDraft, router]);

  const handleMoveTo = useCallback((item: FileBrowserItemData) => {
    setMoveTarget(item);
  }, []);

  const handleMoveConfirm = useCallback(
    async (targetFolderId: string | null) => {
      if (!moveTarget) return;
      try {
        if (moveTarget.kind === "folder") {
          const res = await fetch("/api/folders/move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              folderId: moveTarget.id,
              targetParentId: targetFolderId,
            }),
          });
          if (!res.ok) throw new Error(`status ${res.status}`);
        } else {
          const route =
            moveTarget.kind === "paper"
              ? "papers"
              : moveTarget.kind === "reference"
                ? "references"
                : "notes";
          const res = await fetch(`/api/${route}/${moveTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId: targetFolderId }),
          });
          if (!res.ok) throw new Error(`status ${res.status}`);
        }
        setMoveTarget(null);
        router.refresh();
      } catch {
        toast.error("Failed to move item");
      }
    },
    [moveTarget, router],
  );

  const handleTrash = useCallback(
    async (item: FileBrowserItemData) => {
      try {
        const res = await fetch("/api/folders/trash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ libraryId, target: { kind: item.kind, id: item.id } }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        router.refresh();
      } catch {
        toast.error("Failed to move to trash");
      }
    },
    [libraryId, router],
  );

  const handleRestore = useCallback(
    async (item: FileBrowserItemData) => {
      try {
        const res = await fetch("/api/folders/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ libraryId, target: { kind: item.kind, id: item.id } }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        router.refresh();
      } catch {
        toast.error("Failed to restore item");
      }
    },
    [libraryId, router],
  );

  const handleDeletePermanent = useCallback(
    async (item: FileBrowserItemData) => {
      if (!window.confirm(`Permanently delete "${item.title}"? This cannot be undone.`)) return;
      const plural =
        item.kind === "folder"
          ? "folders"
          : item.kind === "paper"
            ? "papers"
            : item.kind === "reference"
              ? "references"
              : "notes";
      try {
        const res = await fetch(`/api/${plural}/${item.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        router.refresh();
      } catch {
        toast.error("Failed to delete item permanently");
      }
    },
    [router],
  );

  const handleEmptyTrash = useCallback(async () => {
    if (!window.confirm("Empty trash? All items will be permanently deleted.")) return;
    try {
      const res = await fetch("/api/folders/empty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ libraryId }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      router.refresh();
    } catch {
      toast.error("Failed to empty trash");
    }
  }, [libraryId, router]);

  const contextMenuHandlers: FileBrowserContextMenuHandlers = useMemo(
    () => ({
      onOpen: handleOpen,
      onRename: handleRename,
      onMoveTo: handleMoveTo,
      onTrash: handleTrash,
      onRestore: handleRestore,
      onDeletePermanent: handleDeletePermanent,
      onEmptyTrash: handleEmptyTrash,
    }),
    [
      handleOpen,
      handleRename,
      handleMoveTo,
      handleTrash,
      handleRestore,
      handleDeletePermanent,
      handleEmptyTrash,
    ],
  );

  const handleSelect = useCallback(
    (
      id: string,
      ev: ReactMouseEvent<HTMLElement> | { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean },
    ) => {
      const shift = ev.shiftKey === true;
      const meta = ev.metaKey === true || ev.ctrlKey === true;
      if (meta) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        anchorRef.current = id;
        return;
      }
      if (shift && anchorRef.current) {
        const a = orderedIds.indexOf(anchorRef.current);
        const b = orderedIds.indexOf(id);
        if (a === -1 || b === -1) {
          setSelected(new Set([id]));
          anchorRef.current = id;
          return;
        }
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(orderedIds.slice(lo, hi + 1)));
        return;
      }
      setSelected(new Set([id]));
      anchorRef.current = id;
    },
    [orderedIds],
  );

  const handleRootClick = useCallback(
    (ev: ReactMouseEvent<HTMLDivElement>) => {
      if (ev.target === ev.currentTarget) {
        setSelected(new Set());
        anchorRef.current = null;
      }
    },
    [],
  );

  const handleKeyDown = useCallback(
    (ev: KeyboardEvent<HTMLDivElement>) => {
      if (items.length === 0) return;
      const key = ev.key;
      // Arrow navigation — for simplicity, ArrowDown/Right move forward;
      // ArrowUp/Left move back. No per-view axis logic; both views share the
      // same linear order.
      if (key === "ArrowDown" || key === "ArrowRight") {
        ev.preventDefault();
        const anchor = anchorRef.current;
        const idx = anchor ? orderedIds.indexOf(anchor) : -1;
        const nextIdx = Math.min(orderedIds.length - 1, idx + 1);
        const nextId = orderedIds[nextIdx];
        if (nextId) {
          setSelected(new Set([nextId]));
          anchorRef.current = nextId;
        }
        return;
      }
      if (key === "ArrowUp" || key === "ArrowLeft") {
        ev.preventDefault();
        const anchor = anchorRef.current;
        const idx = anchor ? orderedIds.indexOf(anchor) : orderedIds.length;
        const prevIdx = Math.max(0, idx - 1);
        const prevId = orderedIds[prevIdx];
        if (prevId) {
          setSelected(new Set([prevId]));
          anchorRef.current = prevId;
        }
        return;
      }
      if (key === "Enter") {
        const anchor = anchorRef.current;
        if (!anchor) return;
        const item = itemsById.get(anchor);
        if (!item) return;
        ev.preventDefault();
        handleOpen(item);
        return;
      }
      if (key === "F2") {
        // T19 will wire inline rename. No-op stub for now.
        ev.preventDefault();
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        if (selected.size === 0) return;
        ev.preventDefault();
        const ids = Array.from(selected);
        Promise.all(
          ids.map((id) => {
            const item = itemsById.get(id);
            if (!item) return null;
            return fetch("/api/folders/trash", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                libraryId,
                target: { kind: item.kind, id: item.id },
              }),
            });
          }),
        )
          .then(() => {
            setSelected(new Set());
            anchorRef.current = null;
            router.refresh();
          })
          .catch((err) => {
            toast.error("Failed to trash selection");
            console.error(err);
          });
      }
    },
    [items.length, itemsById, orderedIds, selected, libraryId, router, handleOpen],
  );

  // ── Drag & drop ─────────────────────────────────────────────────────────
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [activeDrag, setActiveDrag] = useState<FbDragActive | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = useCallback((e: DragStartEvent) => {
    const data = e.active.data.current as FbDragActive | undefined;
    if (!data) return;
    setActiveDrag(data);
  }, []);

  const onDragCancel = useCallback(() => setActiveDrag(null), []);

  const onDragEnd = useCallback(
    async (e: DragEndEvent) => {
      setActiveDrag(null);
      const activeData = e.active.data.current as FbDragActive | undefined;
      const overData = e.over?.data.current as FbDragOver | undefined;
      if (!activeData || !overData) return;
      const ok = await resolveDrop(activeData, overData, folders);
      if (ok) router.refresh();
    },
    [folders, router],
  );

  const itemView = view === "tile" ? "tile" : "list";

  const grid = (
    <div
      data-testid="fb-root"
      tabIndex={0}
      onClick={handleRootClick}
      onKeyDown={handleKeyDown}
      className={
        itemView === "tile"
          ? "grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 overflow-y-auto p-4 outline-hidden"
          : "flex-1 overflow-y-auto outline-hidden"
      }
    >
      {itemView === "tile" ? (
        items.map((item, i) => (
          <FileBrowserItem
            key={item.id}
            item={item}
            view="tile"
            index={i}
            selected={selected.has(item.id)}
            currentFolderId={folderId}
            isInTrash={isTrashView}
            onSelect={handleSelect}
            onOpen={handleOpen}
            contextMenuHandlers={contextMenuHandlers}
          />
        ))
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortHeader
                  label="Name"
                  column="title"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={toggleSort}
                />
              </TableHead>
              <TableHead>
                <SortHeader
                  label="Type"
                  column="kind"
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
            {sortedItems.map((item, i) => (
              <FileBrowserItem
                key={item.id}
                item={item}
                view="list"
                index={i}
                selected={selected.has(item.id)}
                currentFolderId={folderId}
                isInTrash={isTrashView}
                onSelect={handleSelect}
                onOpen={handleOpen}
                contextMenuHandlers={contextMenuHandlers}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );

  return (
    <>
      <div className="flex h-full flex-col">
        <FileBrowserToolbar
          libraryId={libraryId}
          libraryName={libraryName}
          folderId={folderId}
          folderChain={folderChain}
          view={view}
          onViewChange={setViewPersist}
          onMutate={onMutate}
          isTrashView={isTrashView}
          onEmptyTrash={onEmptyTrashProp ?? handleEmptyTrash}
          trashCount={items.length}
        />

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <p>
              Drop files here, or click <strong className="text-foreground">New</strong>.
            </p>
            <NewItemTrigger
              libraryId={libraryId}
              folderId={folderId}
              variant="toolbar"
              onMutate={onMutate}
            />
          </div>
        ) : mounted ? (
          <DndContext
            sensors={sensors}
            onDragStart={onDragStart}
            onDragCancel={onDragCancel}
            onDragEnd={onDragEnd}
          >
            {grid}
            <DragOverlay>
              {activeDrag ? (
                <div className="pointer-events-none rounded-md bg-accent/80 px-2 py-1 text-sm text-foreground ring-1 ring-foreground/20 shadow-sm">
                  {activeDrag.title ?? "Untitled"}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          grid
        )}
      </div>

      {/* Rename dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => { if (!open) setRenameTarget(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <Input
            data-testid="rename-input"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { void handleRenameSave(); } }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button data-testid="rename-save" onClick={() => void handleRenameSave()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MoveToDialog */}
      {moveTarget !== null && (
        <MoveToDialog
          libraryId={libraryId}
          folders={folders}
          currentFolderId={folderId}
          excludeFolderId={moveTarget.kind === "folder" ? moveTarget.id : null}
          open
          onOpenChange={(open) => { if (!open) setMoveTarget(null); }}
          onMove={handleMoveConfirm}
        />
      )}
    </>
  );
}
