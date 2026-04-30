"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Folder as FolderIcon, FolderTree, Trash2 } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { useExpanded } from "@/hooks/use-expanded";
import { buildFolderTree, type FolderNode, type TreeItem } from "@/lib/tree";
import { isDescendantOf, type FolderRow } from "@/lib/folders";
import type {
  FolderRowOut,
  NoteItem,
  PaperItem,
  PapersetItem,
  ReferenceItem,
} from "@/lib/tree-server";

interface Props {
  libraryId: number;
  folders: FolderRowOut[];
  papers: PaperItem[];
  references: ReferenceItem[];
  notes: NoteItem[];
  papersets: PapersetItem[];
  trashId: string | null;
  onMutate: () => void;
}

// ── Drag / Drop payload types (exported for tests) ────────────────────────────

type ItemKind = "paper" | "reference" | "note" | "paperset";

export interface SidebarDragActive {
  kind: "leaf" | "folder";
  itemKind?: ItemKind;
  /** Leaf id or folder id */
  id?: string;
  /** Leaf: current folderId. Folder: own folder id. */
  folderId?: string | null;
  title?: string;
}

export interface SidebarDragOver {
  kind: "folder" | "root" | "trash";
  /** Target folder id, or null for library root. */
  folderId: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function itemHrefFor(item: TreeItem): string {
  if (item.kind === "paper") return `/p/${item.id}`;
  if (item.kind === "reference") return `/r/${item.id}`;
  if (item.kind === "paperset") return `/d/${item.id}`;
  const slug = (item as TreeItem & { slug?: string }).slug;
  return `/n/${slug ?? item.id}`;
}

function itemLabel(item: TreeItem): string {
  const t = item.title;
  if (typeof t === "string" && t.trim().length > 0) return t;
  return "Untitled";
}

function apiRouteForKind(kind: ItemKind): string {
  if (kind === "paper") return "papers";
  if (kind === "reference") return "references";
  if (kind === "paperset") return "papersets";
  return "notes";
}

/**
 * Pure drop resolver — exported for unit tests.
 * Handles: leaf → folder, leaf → trash, folder → folder, folder → root.
 * Returns true on success.
 */
export async function resolveSidebarDrop(
  active: SidebarDragActive,
  over: SidebarDragOver,
  folders: FolderRow[],
  libraryId?: number,
): Promise<boolean> {
  // ── leaf drop ──
  if (active.kind === "leaf") {
    if (!active.id || !active.itemKind) return false;

    // Drop onto trash
    if (over.kind === "trash") {
      try {
        const res = await fetch("/api/folders/trash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            libraryId,
            target: { kind: active.itemKind, id: active.id },
          }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        return true;
      } catch (err) {
        toast.error(`Failed to move ${active.title ?? active.itemKind} to trash`);
        console.error(err);
        return false;
      }
    }

    // Drop onto folder or root — no-op if same location
    const targetFolderId = over.folderId ?? null;
    if ((active.folderId ?? null) === targetFolderId) return false;

    try {
      const route = apiRouteForKind(active.itemKind);
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

  // ── folder drop ──
  if (active.kind === "folder") {
    if (!active.id) return false;
    const subjectId = active.id;
    const targetParentId = over.folderId ?? null;

    // No-op: dropping onto own current parent
    const subject = folders.find((f) => f.id === subjectId);
    if (subject && (subject.parentId ?? null) === targetParentId) return false;

    // Cycle guard
    if (targetParentId != null) {
      if (
        targetParentId === subjectId ||
        isDescendantOf(folders, subjectId, targetParentId)
      ) {
        toast.error("Cannot move folder into itself");
        return false;
      }
    }

    try {
      const res = await fetch("/api/folders/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: subjectId, targetParentId }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      return true;
    } catch (err) {
      toast.error("Failed to move folder");
      console.error(err);
      return false;
    }
  }

  return false;
}

// ── DriveTree ─────────────────────────────────────────────────────────────────

export function DriveTree({
  libraryId,
  folders,
  papers,
  references,
  notes,
  papersets,
  trashId,
  onMutate,
}: Props) {
  // Unify all items into a single TreeItem[] with their own kind.
  const treeItems: TreeItem[] = useMemo(() => {
    const p: TreeItem[] = papers.map((x) => ({
      id: x.id,
      title: x.title,
      folderId: x.folderId,
      kind: "paper",
    }));
    const r: TreeItem[] = references.map((x) => ({
      id: x.id,
      title: x.title,
      folderId: x.folderId,
      kind: "reference",
    }));
    const n: TreeItem[] = notes.map((x) => ({
      id: x.id,
      title: x.title,
      folderId: x.folderId,
      kind: "note",
      // Preserve slug for href.
      ...{ slug: x.slug },
    })) as TreeItem[];
    const d: TreeItem[] = papersets.map((x) => ({
      id: x.id,
      title: x.title,
      folderId: x.folderId,
      kind: "paperset",
    }));
    return [...p, ...r, ...n, ...d];
  }, [papers, references, notes, papersets]);

  const root = useMemo(
    () => buildFolderTree(folders, treeItems, { includeTrash: false }),
    [folders, treeItems],
  );

  // Flat FolderRow[] for cycle-check
  const allFolderRows: FolderRow[] = useMemo(
    () =>
      folders.map((f) => ({
        id: f.id,
        parentId: f.parentId,
        name: f.name,
        isTrash: f.isTrash,
      })),
    [folders],
  );

  // Trash badge logic: any item whose folderId is the trashId?
  const trashNonEmpty = useMemo(() => {
    if (!trashId) return false;
    return treeItems.some((it) => it.folderId === trashId);
  }, [treeItems, trashId]);

  // Mount guard: dnd-kit generates incremental aria-describedby IDs that
  // diverge between server and client renders. Only attach DndContext after
  // hydration to avoid SSR/client mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [activeDrag, setActiveDrag] = useState<{ data: SidebarDragActive; label: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as SidebarDragActive | undefined;
    if (!data) return;
    const label =
      data.title && data.title.trim().length > 0 ? data.title : "Untitled";
    setActiveDrag({ data, label });
  };

  const onDragCancel = () => setActiveDrag(null);

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveDrag(null);
    const activeData = e.active.data.current as SidebarDragActive | undefined;
    const overData = e.over?.data.current as SidebarDragOver | undefined;
    if (!activeData || !overData) return;
    const ok = await resolveSidebarDrop(activeData, overData, allFolderRows, libraryId);
    if (ok) onMutate();
  };

  const tree = (
    <SidebarMenu>
      {root.children.map((child) => (
        <DriveFolderRow
          key={`folder:${child.folder?.id ?? "x"}`}
          node={child}
          depth={1}
          libraryId={libraryId}
          onMutate={onMutate}
        />
      ))}
      {root.items.map((item) => (
        <DriveLeafRow key={`leaf:${item.kind}:${item.id}`} item={item} />
      ))}
      <TrashDroppable trashId={trashId} nonEmpty={trashNonEmpty} />
      <DriveRootDroppable />
    </SidebarMenu>
  );

  const driveKey = `${libraryId}:drive:root`;
  const [driveOpen, setDriveOpen] = useExpanded(driveKey, false);
  const hasContent = root.children.length > 0 || root.items.length > 0;

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="h-auto bg-background border border-border/60 rounded-md px-2 py-1.5 text-[13px] font-semibold text-foreground [&>svg]:size-3 [&>svg]:text-foreground">
        <button
          type="button"
          onClick={() => setDriveOpen(!driveOpen)}
          aria-expanded={driveOpen}
          className="flex w-full items-center gap-2 text-[13px] font-semibold text-foreground"
        >
          <FolderTree aria-hidden className="size-3 text-foreground" />
          Drive
          {hasContent && (
            <ChevronRight
              className={`ml-auto !size-3.5 text-foreground transition-transform ${driveOpen ? "rotate-90" : ""}`}
              aria-hidden
            />
          )}
        </button>
      </SidebarGroupLabel>
      {driveOpen && (
        <SidebarGroupContent>
          {mounted ? (
            <DndContext
              sensors={sensors}
              onDragStart={onDragStart}
              onDragCancel={onDragCancel}
              onDragEnd={onDragEnd}
            >
              {tree}
              <DragOverlay>
                {activeDrag ? (
                  <div className="pointer-events-none rounded-md bg-sidebar-accent/80 px-2 py-1 text-sm text-sidebar-foreground ring-1 ring-foreground/20 shadow-sm">
                    {activeDrag.label}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            tree
          )}
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}

// ── DriveFolderRow ────────────────────────────────────────────────────────────

function DriveFolderRow({
  node,
  depth,
  libraryId,
  onMutate,
}: {
  node: FolderNode;
  depth: number;
  libraryId: number;
  onMutate: () => void;
}) {
  const folder = node.folder!;
  const storageKey = `${libraryId}:drive:${folder.id}`;
  const [open, setOpen] = useExpanded(storageKey, false);
  const empty = node.items.length === 0 && node.children.length === 0;

  const dragData: SidebarDragActive = {
    kind: "folder",
    id: folder.id,
    folderId: folder.id,
    title: folder.name,
  };
  const dropData: SidebarDragOver = {
    kind: "folder",
    folderId: folder.id,
  };

  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: `drag:folder:drive:${folder.id}`, data: dragData });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:folder:drive:${folder.id}`,
    data: dropData,
  });

  // Merge drag + drop refs onto the button element
  const setRef = (node: HTMLButtonElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  const ButtonComp = depth === 1 ? SidebarMenuButton : SidebarMenuSubButton;
  const Wrapper = depth === 1 ? SidebarMenuItem : SidebarMenuSubItem;

  return (
    <Wrapper>
      <ButtonComp
        render={
          <button
            type="button"
            ref={setRef}
            {...attributes}
            {...listeners}
          />
        }
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        data-over={isOver ? "true" : undefined}
        className={`${empty ? "text-muted-foreground" : ""}${isDragging ? " opacity-50" : ""} data-[over=true]:ring-1 data-[over=true]:ring-foreground/20 data-[over=true]:bg-sidebar-accent/50`}
      >
        <ChevronRight
          className={`transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
        <FolderIcon aria-hidden />
        <span>{folder.name}</span>
      </ButtonComp>
      {open && !empty && (
        <SidebarMenuSub>
          {node.children.map((child) => (
            <DriveFolderRow
              key={`folder:${child.folder?.id ?? "x"}`}
              node={child}
              depth={depth + 1}
              libraryId={libraryId}
              onMutate={onMutate}
            />
          ))}
          {node.items.map((item) => (
            <SidebarMenuSubItem key={`leaf:${item.kind}:${item.id}`}>
              <DriveSubLeaf item={item} />
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </Wrapper>
  );
}

// ── DriveLeafRow ──────────────────────────────────────────────────────────────

function DriveLeafRow({ item }: { item: TreeItem }) {
  const pathname = usePathname();
  const href = itemHrefFor(item);
  const hasTitle = typeof item.title === "string" && item.title.trim().length > 0;

  const dragData: SidebarDragActive = {
    kind: "leaf",
    itemKind: item.kind as ItemKind,
    id: item.id,
    folderId: item.folderId,
    title: item.title ?? undefined,
  };
  const {
    setNodeRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: `drag:leaf:drive:${item.kind}:${item.id}`, data: dragData });

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={
          <Link
            href={href}
            ref={setNodeRef}
            {...attributes}
            {...listeners}
          />
        }
        isActive={pathname === href}
        className={`data-[active=true]:bg-transparent data-[active=true]:border-l-2 data-[active=true]:border-foreground data-[active=true]:font-medium data-[active=true]:rounded-l-none data-[active=true]:pl-[calc(0.5rem-2px)]${hasTitle ? "" : " text-muted-foreground italic"}${isDragging ? " opacity-50" : ""}`}
      >
        <span>{itemLabel(item)}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// ── DriveSubLeaf ──────────────────────────────────────────────────────────────

function DriveSubLeaf({ item }: { item: TreeItem }) {
  const pathname = usePathname();
  const href = itemHrefFor(item);
  const hasTitle = typeof item.title === "string" && item.title.trim().length > 0;

  const dragData: SidebarDragActive = {
    kind: "leaf",
    itemKind: item.kind as ItemKind,
    id: item.id,
    folderId: item.folderId,
    title: item.title ?? undefined,
  };
  const {
    setNodeRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: `drag:subleaf:drive:${item.kind}:${item.id}`, data: dragData });

  return (
    <SidebarMenuSubButton
      render={
        <Link
          href={href}
          ref={setNodeRef}
          {...attributes}
          {...listeners}
        />
      }
      isActive={pathname === href}
      className={`data-[active=true]:bg-transparent data-[active=true]:border-l-2 data-[active=true]:border-foreground data-[active=true]:font-medium data-[active=true]:rounded-l-none data-[active=true]:pl-[calc(0.5rem-2px)]${hasTitle ? "" : " text-muted-foreground italic"}${isDragging ? " opacity-50" : ""}`}
    >
      <span>{itemLabel(item)}</span>
    </SidebarMenuSubButton>
  );
}

// ── TrashDroppable ────────────────────────────────────────────────────────────

function TrashDroppable({
  trashId,
  nonEmpty,
}: {
  trashId: string | null;
  nonEmpty: boolean;
}) {
  const pathname = usePathname();
  const href = trashId ? `/trash` : "#";
  const active = pathname === href;

  const dropData: SidebarDragOver = { kind: "trash", folderId: trashId };
  const { setNodeRef, isOver } = useDroppable({
    id: "drop:drive:trash",
    data: dropData,
    disabled: !trashId,
  });

  return (
    <SidebarMenuItem data-testid="sidebar-trash">
      <SidebarMenuButton
        render={<Link href={href} ref={setNodeRef} />}
        isActive={active}
        data-over={isOver ? "true" : undefined}
        className="data-[active=true]:bg-transparent data-[active=true]:border-l-2 data-[active=true]:border-foreground data-[active=true]:font-medium data-[active=true]:rounded-l-none data-[active=true]:pl-[calc(0.5rem-2px)] data-[over=true]:ring-1 data-[over=true]:ring-foreground/20 data-[over=true]:bg-sidebar-accent/50"
      >
        <Trash2 aria-hidden />
        <span>Trash</span>
        {nonEmpty ? (
          <span
            data-testid="sidebar-trash-badge"
            aria-label="Trash has items"
            className="ml-auto inline-block size-1.5 rounded-full bg-foreground/70"
          />
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// ── DriveRootDroppable ────────────────────────────────────────────────────────
// A small invisible droppable zone below all rows; drop here → folderId = null

function DriveRootDroppable() {
  const dropData: SidebarDragOver = { kind: "root", folderId: null };
  const { setNodeRef, isOver } = useDroppable({
    id: "drop:drive:root",
    data: dropData,
  });
  return (
    <li
      ref={setNodeRef}
      data-over={isOver ? "true" : undefined}
      aria-label="Drop here to move to library root"
      className="mt-1 h-3 rounded-md data-[over=true]:ring-1 data-[over=true]:ring-foreground/20 data-[over=true]:bg-sidebar-accent/50"
    />
  );
}
