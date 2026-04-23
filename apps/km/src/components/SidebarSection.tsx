"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookMarked, FileText, NotebookPen } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
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
} from "@/components/ui/sidebar";
import { buildFolderTree, type TreeItem } from "@/lib/tree";
import { isDescendantOf, type FolderRow } from "@/lib/folders";
import type {
  FolderRowOut,
  NoteItem,
  PaperItem,
  ReferenceItem,
} from "@/lib/tree-server";
import { SidebarFolder } from "./SidebarFolder";
import { SidebarAgentSection } from "./SidebarAgentSection";
import { SidebarContextMenu } from "./SidebarContextMenu";
import { NewItemTrigger } from "./NewItemTrigger";

type ContentSection = "papers" | "references" | "notes";
type ItemKind = "paper" | "reference" | "note";

interface ContentProps {
  kind: ContentSection;
  label: string;
  folders: FolderRowOut[];
  items: (PaperItem | ReferenceItem | NoteItem)[];
  libraryId: number;
  onMutate: () => void;
}

interface AgentProps {
  kind: "agent";
}

type Props = ContentProps | AgentProps;

const SECTION_ICON = {
  papers: FileText,
  references: BookMarked,
  notes: NotebookPen,
} as const;

const SECTION_TO_ITEM_KIND: Record<ContentSection, ItemKind> = {
  papers: "paper",
  references: "reference",
  notes: "note",
};

const SECTION_TO_ROUTE: Record<ContentSection, string> = {
  papers: "papers",
  references: "references",
  notes: "notes",
};

export interface DragData {
  kind: "leaf" | "folder" | "section-root";
  /** For leaf drags: which item kind (paper/reference/note). */
  itemKind?: ItemKind;
  /** Leaf drag: item uuid. Folder drag: folder uuid. */
  id?: string;
  /** Leaf drag: current folderId (or null = root). Folder drag: own folder id. Droppable: target folderId (null = root). */
  folderId?: string | null;
  title?: string;
}

interface ActiveDrag {
  data: DragData;
  label: string;
}

export function SidebarSection(props: Props) {
  if (props.kind === "agent") {
    return <SidebarAgentSection />;
  }
  return <ContentSectionWithDnd {...props} />;
}

function ContentSectionWithDnd(props: ContentProps) {
  const Icon = SECTION_ICON[props.kind];
  const itemKind = SECTION_TO_ITEM_KIND[props.kind];

  // Convert typed items → TreeItem[] for the builder.
  // Preserve slug for notes so the leaf renderer can build /n/:slug hrefs.
  const treeItems: TreeItem[] = useMemo(
    () =>
      props.items.map((it) => {
        const slug = (it as { slug?: string }).slug;
        return {
          id: it.id,
          title: it.title ?? null,
          folderId: it.folderId ?? null,
          kind: itemKind,
          ...(slug ? { slug } : {}),
        } as TreeItem;
      }),
    [props.items, itemKind],
  );

  // For notes, show folder rows. For papers/references, folders still show up
  // via the same `folders` table (post-unification), but items only carry
  // folderId for notes today — ok, same shape.
  const tree = useMemo(
    () => buildFolderTree(props.folders, treeItems),
    [props.folders, treeItems],
  );

  // Flat FolderRow[] for isDescendantOf cycle check.
  const allFolderRows: FolderRow[] = useMemo(
    () =>
      props.folders.map((f) => ({
        id: f.id,
        parentId: f.parentId,
        name: f.name,
        isTrash: f.isTrash,
      })),
    [props.folders],
  );

  const canOpenHeaderMenu = props.kind === "notes";
  const [active, setActive] = useState<ActiveDrag | null>(null);
  // dnd-kit generates incremental aria-describedby IDs that diverge between
  // server and client renders. Gate the DndContext behind a mounted flag so
  // SSR emits plain rows and drag wiring attaches only after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragData | undefined;
    if (!data) return;
    const label =
      data.title && data.title.trim().length > 0 ? data.title : "Untitled";
    setActive({ data, label });
  };

  const onDragCancel = () => setActive(null);

  const onDragEnd = async (e: DragEndEvent) => {
    setActive(null);
    const activeData = e.active.data.current as DragData | undefined;
    const overData = e.over?.data.current as DragData | undefined;
    if (!activeData || !overData) return;

    if (activeData.kind === "leaf") {
      if (!activeData.id || !activeData.itemKind) return;
      const targetFolderId = overData.folderId ?? null;
      if ((activeData.folderId ?? null) === targetFolderId) return;
      try {
        const route = SECTION_TO_ROUTE[itemKindToSection(activeData.itemKind)];
        const res = await fetch(`/api/${route}/${activeData.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId: targetFolderId }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        props.onMutate();
      } catch (err) {
        toast.error(`Failed to move ${describeLeaf(activeData)}`);
        console.error(err);
      }
      return;
    }

    if (activeData.kind === "folder") {
      if (!activeData.id) return;
      const subjectId = activeData.id;
      const targetParentId = overData.folderId ?? null;
      // No-op: dropping on own parent.
      const subject = allFolderRows.find((f) => f.id === subjectId);
      if (subject && (subject.parentId ?? null) === targetParentId) return;
      // Cycle guard: target must not be the subject itself, nor a descendant.
      if (targetParentId != null) {
        if (targetParentId === subjectId || isDescendantOf(allFolderRows, subjectId, targetParentId)) {
          toast.error("Cannot move folder into itself");
          return;
        }
      }
      try {
        const res = await fetch("/api/folders/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId: subjectId, targetParentId }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        props.onMutate();
      } catch (err) {
        toast.error("Failed to move folder");
        console.error(err);
      }
    }
  };

  const sectionHref =
    props.kind === "papers"
      ? "/papers"
      : props.kind === "references"
        ? "/references"
        : null;
  const label = (
    <SidebarGroupLabel className="gap-2 text-[11px] font-medium tracking-[0.14em] uppercase text-muted-foreground">
      <Icon data-icon="inline-start" aria-hidden />
      {sectionHref ? (
        <Link href={sectionHref} className="hover:text-foreground">
          {props.label}
        </Link>
      ) : (
        props.label
      )}
    </SidebarGroupLabel>
  );

  return (
    <SidebarGroup>
      {canOpenHeaderMenu ? (
        <SidebarContextMenu
          target={{ kind: "section-header", section: props.kind }}
          libraryId={props.libraryId}
          onMutate={props.onMutate}
        >
          {label}
        </SidebarContextMenu>
      ) : (
        label
      )}
      {props.kind === "notes" && (
        <NewItemTrigger
          libraryId={props.libraryId}
          folderId={null}
          onMutate={props.onMutate}
          variant="group"
        />
      )}
      <SidebarGroupContent>
        {mounted ? (
          <DndContext
            sensors={sensors}
            onDragStart={onDragStart}
            onDragCancel={onDragCancel}
            onDragEnd={onDragEnd}
          >
            <SidebarMenu>
              <SidebarFolder
                node={tree}
                section={props.kind}
                depth={0}
                libraryId={props.libraryId}
                allFolders={allFolderRows}
                onMutate={props.onMutate}
              />
              <SectionRootDroppable section={props.kind} />
            </SidebarMenu>
            <DragOverlay>
              {active ? (
                <div className="pointer-events-none rounded-md bg-sidebar-accent/80 px-2 py-1 text-sm text-sidebar-foreground ring-1 ring-foreground/20 shadow-sm">
                  {active.label}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <SidebarMenu>
            <SidebarFolder
              node={tree}
              section={props.kind}
              depth={0}
              libraryId={props.libraryId}
              allFolders={allFolderRows}
              onMutate={props.onMutate}
            />
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function SectionRootDroppable({ section }: { section: ContentSection }) {
  const data: DragData = { kind: "section-root", folderId: null };
  const { setNodeRef, isOver } = useDroppable({
    id: `section-root:${section}`,
    data,
  });
  return (
    <li
      ref={setNodeRef}
      data-over={isOver ? "true" : undefined}
      aria-label="Drop here to move to section root"
      className="mt-1 h-3 rounded-md data-[over=true]:ring-1 data-[over=true]:ring-foreground/20 data-[over=true]:bg-sidebar-accent/50"
    />
  );
}

function itemKindToSection(k: ItemKind): ContentSection {
  if (k === "paper") return "papers";
  if (k === "reference") return "references";
  return "notes";
}

function describeLeaf(d: DragData): string {
  if (d.title && d.title.trim().length > 0) return d.title;
  return d.itemKind ?? "item";
}
