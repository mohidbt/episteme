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
import { useTabsOptional } from "@/components/TabBar";

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
  /**
   * View to use when localStorage has no persisted preference. Defaults to
   * "tile". Guest accounts pass "list" so the first-paint experience matches
   * the demo guidance.
   */
  defaultView?: ViewMode;
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
  /** When present, this drag represents a batch move of multiple selected ids. */
  ids?: string[];
}
export type FbDragOver =
  | { kind: "folder"; id: string }
  | { kind: "ancestor"; folderId: string | null };

/**
 * Axis-aligned rectangle intersection test. Exported for unit tests.
 * Both rects are {x0, y0, x1, y1} where x0<=x1 and y0<=y1 is NOT required —
 * the helper normalizes. Returns true if rectangles share any area (edge-only
 * contact counts as no overlap).
 */
export function rectsIntersect(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  const aL = Math.min(a.x0, a.x1);
  const aR = Math.max(a.x0, a.x1);
  const aT = Math.min(a.y0, a.y1);
  const aB = Math.max(a.y0, a.y1);
  const bL = Math.min(b.x0, b.x1);
  const bR = Math.max(b.x0, b.x1);
  const bT = Math.min(b.y0, b.y1);
  const bB = Math.max(b.y0, b.y1);
  return aL < bR && aR > bL && aT < bB && aB > bT;
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
  const assets: FileBrowserItemData[] = contents.assets.map((a) => ({
    id: a.id,
    kind: "asset" as ItemKind,
    title: a.filename,
    updatedAt: toMs(a.updatedAt),
    href: null,
    mimeType: a.mimeType,
  }));
  const papersets: FileBrowserItemData[] = contents.papersets.map((p) => ({
    id: p.id,
    kind: "paperset" as ItemKind,
    title: p.filename,
    updatedAt: toMs(p.updatedAt),
    href: `/d/${p.id}`,
  }));
  return [...folders, ...papers, ...refs, ...notes, ...assets, ...papersets];
}

function apiRouteForKind(kind: ItemKind): string | null {
  if (kind === "paper") return "papers";
  if (kind === "reference") return "references";
  if (kind === "note") return "notes";
  if (kind === "asset") return "assets";
  if (kind === "paperset") return "papersets";
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
  // Target folder id (null = library root). For a folder drop, this is over.id;
  // for an ancestor (breadcrumb) drop, over.folderId (may be null).
  const targetFolderId: string | null =
    over.kind === "folder" ? over.id : over.folderId;

  if (active.kind === "leaf") {
    if (!active.itemKind) return false;
    const route = apiRouteForKind(active.itemKind);
    if (!route) return false;
    // No-op if already in that folder.
    if ((active.currentFolderId ?? null) === targetFolderId) return false;
    try {
      const res = await fetch(`/api/${route}/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: targetFolderId }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      return true;
    } catch (err) {
      toast.error(`Failed to move ${active.title ?? active.itemKind}`);
      console.error(err);
      return false;
    }
  }

  // Folder → (folder | ancestor).
  if (over.kind === "folder" && active.id === over.id) return false;
  if (
    over.kind === "folder" &&
    isDescendantOf(folders, active.id, over.id)
  ) {
    toast.error("Cannot move folder into itself");
    return false;
  }
  try {
    const res = await fetch("/api/folders/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderId: active.id,
        targetParentId: targetFolderId,
      }),
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
  defaultView = "tile",
}: Props) {
  const router = useRouter();
  const tabsApi = useTabsOptional();
  const [view, setView] = useState<ViewMode>(defaultView);
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
  // Task #20: optimistic title overrides so a successful rename reflects in
  // the UI without waiting for `router.refresh()` to round-trip the Server
  // Component data. Keyed by `${kind}:${id}` since ids may collide across
  // kinds.
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({});

  // ── MoveToDialog ──────────────────────────────────────────────────────────
  const [moveTarget, setMoveTarget] = useState<FileBrowserItemData | null>(null);

  const items = useMemo(() => {
    const base = flatten(contents);
    if (Object.keys(titleOverrides).length === 0) return base;
    return base.map((it) => {
      const k = `${it.kind}:${it.id}`;
      const override = titleOverrides[k];
      return override !== undefined ? { ...it, title: override } : it;
    });
  }, [contents, titleOverrides]);

  // ── List-view sort ───────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<"title" | "kind" | "updatedAt">("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sortedItems = useMemo(() => {
    const kindOrder: Record<ItemKind, number> = {
      folder: 0,
      paper: 1,
      reference: 2,
      note: 3,
      asset: 4,
      data: 5,
      paperset: 6,
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
    (item: FileBrowserItemData, opts?: { newTab?: boolean }) => {
      if (item.kind === "folder") {
        const segments = [
          ...folderChain.map((c) => c.name),
          item.title,
        ].map(encodeURIComponent);
        const href = `/drive/${segments.join("/")}`;
        if (opts?.newTab) {
          tabsApi?.openInNewTab(href, item.title);
          return;
        }
        router.push(href);
        return;
      }
      if (item.kind === "asset") {
        // TODO: image lightbox preview. Today: fetch presigned downloadUrl
        // and open in a new tab — works for both images and other MIMEs.
        void fetch(`/api/assets/${item.id}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
          .then((body: { downloadUrl?: string }) => {
            if (body.downloadUrl) window.open(body.downloadUrl, "_blank", "noopener,noreferrer");
          })
          .catch(() => toast.error("Failed to open asset"));
        return;
      }
      if (item.href) {
        if (opts?.newTab) {
          tabsApi?.openInNewTab(item.href, item.title);
          return;
        }
        router.push(item.href);
      }
    },
    [router, folderChain, tabsApi],
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
    const body =
      kind === "folder"
        ? { name }
        : kind === "asset" || kind === "paperset"
          ? { filename: name }
          : { title: name };
    const route =
      kind === "folder"
        ? `folders/${id}`
        : kind === "paper"
          ? `papers/${id}`
          : kind === "reference"
            ? `references/${id}`
            : kind === "asset"
              ? `assets/${id}`
              : kind === "paperset"
                ? `papersets/${id}`
                : `notes/${id}`;
    try {
      const res = await fetch(`/api/${route}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      // Task #20: apply optimistic local override so the new name shows
      // immediately, even if the upstream Server Component refresh is
      // delayed/cached.
      setTitleOverrides((prev) => ({ ...prev, [`${kind}:${id}`]: name }));
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
                : moveTarget.kind === "asset"
                  ? "assets"
                  : moveTarget.kind === "paperset"
                    ? "papersets"
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
        // Assets have no `prevFolderId` and no trash flow yet — hard delete.
        // TODO: full trash/restore for assets.
        if (item.kind === "asset") {
          if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
          const res = await fetch(`/api/assets/${item.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error(`status ${res.status}`);
          router.refresh();
          return;
        }
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
              : item.kind === "asset"
                ? "assets"
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
      if (suppressClickRef.current) return;
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

  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const onDragStart = useCallback((e: DragStartEvent) => {
    const data = e.active.data.current as FbDragActive | undefined;
    if (!data) return;
    // Finder behavior: if dragging an unselected item, auto-select just it.
    // If dragging a selected item with >1 selected, batch-move all selected.
    const current = selectedRef.current;
    let enriched: FbDragActive = data;
    if (!current.has(data.id)) {
      const only = new Set([data.id]);
      setSelected(only);
      selectedRef.current = only;
      anchorRef.current = data.id;
    } else if (current.size > 1) {
      enriched = { ...data, ids: Array.from(current) };
    }
    setActiveDrag(enriched);
  }, []);

  const onDragCancel = useCallback(() => setActiveDrag(null), []);

  const onDragEnd = useCallback(
    async (e: DragEndEvent) => {
      const active = activeDrag;
      setActiveDrag(null);
      const activeData = e.active.data.current as FbDragActive | undefined;
      const overData = e.over?.data.current as FbDragOver | undefined;
      if (!activeData || !overData) return;

      // Batch path: move every selected id.
      const batchIds = active?.ids ?? activeData.ids;
      if (batchIds && batchIds.length > 1) {
        const targetFolderId: string | null =
          overData.kind === "folder" ? overData.id : overData.folderId;
        const results = await Promise.all(
          batchIds.map(async (id) => {
            const item = itemsById.get(id);
            if (!item) return false;
            if (item.kind === "folder") {
              return resolveDrop(
                {
                  kind: "folder",
                  id: item.id,
                  title: item.title,
                  currentFolderId: folderId,
                },
                overData,
                folders,
              );
            }
            return resolveDrop(
              {
                kind: "leaf",
                itemKind: item.kind,
                id: item.id,
                title: item.title,
                currentFolderId: folderId,
              },
              overData,
              folders,
            );
          }),
        );
        // Avoid unused targetFolderId lint (used implicitly through resolveDrop).
        void targetFolderId;
        if (results.some(Boolean)) router.refresh();
        return;
      }

      const ok = await resolveDrop(activeData, overData, folders);
      if (ok) router.refresh();
    },
    [activeDrag, folders, folderId, itemsById, router],
  );

  // ── Marquee (rubber-band) multi-selection ──────────────────────────────
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [marquee, setMarquee] = useState<
    { x0: number; y0: number; x1: number; y1: number } | null
  >(null);
  const marqueeStartRef = useRef<
    | {
        x0: number;
        y0: number;
        rootLeft: number;
        rootTop: number;
        base: Set<string>;
        additive: boolean;
        moved: boolean;
      }
    | null
  >(null);
  const suppressClickRef = useRef(false);

  const computeMarqueeSelection = useCallback(
    (viewportRect: { x0: number; y0: number; x1: number; y1: number }) => {
      if (!rootRef.current) return;
      const start = marqueeStartRef.current;
      if (!start) return;
      const nodes = rootRef.current.querySelectorAll<HTMLElement>(
        "[data-testid^='fb-item-']",
      );
      const hit = new Set<string>();
      for (const el of Array.from(nodes)) {
        const rect = el.getBoundingClientRect();
        const elR = { x0: rect.left, y0: rect.top, x1: rect.right, y1: rect.bottom };
        if (rectsIntersect(viewportRect, elR)) {
          const id = el.getAttribute("data-testid")!.slice("fb-item-".length);
          hit.add(id);
        }
      }
      const next = start.additive ? new Set([...start.base, ...hit]) : hit;
      setSelected(next);
    },
    [],
  );

  const handleRootMouseDown = useCallback(
    (ev: ReactMouseEvent<HTMLDivElement>) => {
      // Only start marquee on empty background — not on a tile.
      // In list view (and tile view at root), child rows fill the container
      // so `ev.target !== ev.currentTarget` is always true. Use a row-aware
      // check: if the click is inside a file/folder row, bail; otherwise
      // we're on empty space and it's a marquee start.
      if (ev.button !== 0) return;
      const target = ev.target as Element | null;
      if (target?.closest?.('[data-testid^="fb-item-"]')) return;
      // Also bail on interactive controls embedded in the empty area
      // (e.g. column header buttons in list view).
      if (target?.closest?.("button, a, input, [role='button']")) return;
      const root = ev.currentTarget;
      const box = root.getBoundingClientRect();
      marqueeStartRef.current = {
        x0: ev.clientX,
        y0: ev.clientY,
        rootLeft: box.left,
        rootTop: box.top,
        base: new Set(selectedRef.current),
        additive: ev.shiftKey || ev.metaKey || ev.ctrlKey,
        moved: false,
      };
    },
    [],
  );

  useEffect(() => {
    function onMove(ev: MouseEvent) {
      const s = marqueeStartRef.current;
      if (!s) return;
      const dx = ev.clientX - s.x0;
      const dy = ev.clientY - s.y0;
      if (!s.moved && Math.hypot(dx, dy) < 3) return;
      s.moved = true;
      const viewport = {
        x0: s.x0,
        y0: s.y0,
        x1: ev.clientX,
        y1: ev.clientY,
      };
      // Render rectangle in root-local coords.
      setMarquee({
        x0: s.x0 - s.rootLeft,
        y0: s.y0 - s.rootTop,
        x1: ev.clientX - s.rootLeft,
        y1: ev.clientY - s.rootTop,
      });
      computeMarqueeSelection(viewport);
    }
    function onUp() {
      const s = marqueeStartRef.current;
      marqueeStartRef.current = null;
      setMarquee(null);
      if (s?.moved) {
        // Suppress the click that fires after a drag — otherwise handleRootClick
        // would clear the selection we just built.
        suppressClickRef.current = true;
        // Reset on next tick so only the immediately-following click is muted.
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [computeMarqueeSelection]);

  const itemView = view === "tile" ? "tile" : "list";

  const grid = (
    <div
      ref={rootRef}
      data-testid="fb-root"
      tabIndex={0}
      onClick={handleRootClick}
      onMouseDown={handleRootMouseDown}
      onKeyDown={handleKeyDown}
      className={
        itemView === "tile"
          ? "relative grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-4 gap-y-6 overflow-y-auto p-4 outline-hidden"
          : "relative flex-1 overflow-y-auto outline-hidden"
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
            selectedIds={selected}
            currentFolderId={folderId}
            isInTrash={isTrashView}
            onSelect={handleSelect}
            onOpen={handleOpen}
            contextMenuHandlers={contextMenuHandlers}
          />
        ))
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-full min-w-0">
                <SortHeader
                  label="Name"
                  column="title"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={toggleSort}
                />
              </TableHead>
              <TableHead className="w-28">
                <SortHeader
                  label="Type"
                  column="kind"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={toggleSort}
                />
              </TableHead>
              <TableHead className="w-32">
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
                selectedIds={selected}
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
      {marquee ? (
        <div
          data-testid="fb-marquee"
          className="pointer-events-none absolute z-10 rounded-sm border-2 border-primary/50 bg-primary/10"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      ) : null}
    </div>
  );

  const toolbar = (
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
  );

  return (
    <>
      <div className="flex h-full flex-col">
        {items.length === 0 ? (
          <>
            {toolbar}
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
              {isTrashView ? (
                <p>Trash is empty.</p>
              ) : (
                <>
                  <p>
                    Drop files here, or click <strong className="text-foreground">New</strong>.
                  </p>
                  <NewItemTrigger
                    libraryId={libraryId}
                    folderId={folderId}
                    variant="toolbar"
                    onMutate={onMutate}
                  />
                </>
              )}
            </div>
          </>
        ) : mounted ? (
          <DndContext
            sensors={sensors}
            onDragStart={onDragStart}
            onDragCancel={onDragCancel}
            onDragEnd={onDragEnd}
          >
            {toolbar}
            {grid}
            <DragOverlay>
              {activeDrag ? (
                <div className="pointer-events-none rounded-md bg-accent/80 px-2 py-1 text-sm text-foreground ring-1 ring-foreground/20 shadow-sm">
                  {activeDrag.ids && activeDrag.ids.length > 1
                    ? `${activeDrag.ids.length} items`
                    : (activeDrag.title ?? "Untitled")}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <>
            {toolbar}
            {grid}
          </>
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
