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
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

export function FileBrowser({
  libraryId,
  libraryName,
  folderId,
  folderChain,
  contents,
  folders,
}: Props) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("tile");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);

  const items = useMemo(() => flatten(contents), [contents]);
  const itemsById = useMemo(() => {
    const map = new Map<string, FileBrowserItemData>();
    for (const i of items) map.set(i.id, i);
    return map;
  }, [items]);
  const orderedIds = useMemo(() => items.map((i) => i.id), [items]);

  const handleOpen = useCallback(
    (item: FileBrowserItemData) => {
      if (item.kind === "folder") {
        router.push(`/drive/${encodeURIComponent(item.title)}`);
        return;
      }
      if (item.href) router.push(item.href);
    },
    [router],
  );

  const onMutate = useCallback(() => router.refresh(), [router]);

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
          ? "grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4 overflow-y-auto p-4 outline-hidden"
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
            onSelect={handleSelect}
            onOpen={handleOpen}
          />
        ))
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Folder</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, i) => (
              <FileBrowserItem
                key={item.id}
                item={item}
                view="list"
                index={i}
                selected={selected.has(item.id)}
                currentFolderId={folderId}
                onSelect={handleSelect}
                onOpen={handleOpen}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <FileBrowserToolbar
        libraryId={libraryId}
        libraryName={libraryName}
        folderId={folderId}
        folderChain={folderChain}
        view={view}
        onViewChange={setView}
        onMutate={onMutate}
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
  );
}
