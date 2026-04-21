"use client";

import { useEffect, useState } from "react";
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
import { buildFolderTree, computeFolderRename, computeMovePatch } from "@/lib/tree";
import type { NoteItem, PaperItem, ReferenceItem } from "@/lib/tree-server";
import { SidebarFolder } from "./SidebarFolder";
import { SidebarAgentSection } from "./SidebarAgentSection";
import { SidebarContextMenu } from "./SidebarContextMenu";

type ContentSection = "papers" | "references" | "notes";

interface ContentProps {
  kind: ContentSection;
  label: string;
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

export interface DragData {
  section: ContentSection;
  kind: "leaf" | "folder" | "section-root";
  id?: string;
  folderPath: string;
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
  const tree = buildFolderTree(props.items);
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
      data.kind === "folder"
        ? folderLeafName(data.folderPath)
        : (data.title && data.title.trim().length > 0 ? data.title : "Untitled");
    setActive({ data, label });
  };

  const onDragCancel = () => setActive(null);

  const onDragEnd = async (e: DragEndEvent) => {
    setActive(null);
    const activeData = e.active.data.current as DragData | undefined;
    const overData = e.over?.data.current as DragData | undefined;
    if (!activeData || !overData) return;

    // Safeguard: same-section only. Section-scoped DndContext should already
    // prevent cross-section drags, but be defensive.
    if (activeData.section !== overData.section) {
      toast.error("Cross-section moves are not supported");
      return;
    }

    if (activeData.kind === "leaf") {
      if (!activeData.id) return;
      const patch = computeMovePatch({
        draggedSection: activeData.section,
        targetSection: overData.section,
        currentFolderPath: activeData.folderPath,
        targetFolderPath: overData.folderPath,
        draggedKind: "leaf",
      });
      if (!patch) return;
      try {
        const res = await fetch(`/api/${activeData.section}/${activeData.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderPath: patch.folder_path }),
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
      const result = computeFolderRename({
        currentFolderPath: activeData.folderPath,
        newParentPath: overData.folderPath,
      });
      if (!result) {
        // Most common reason here is cycle or no-op; silently ignore no-op,
        // surface cycle.
        const cur = activeData.folderPath;
        const tgt = overData.folderPath;
        if (cur && tgt && tgt.startsWith(cur)) {
          toast.error("Cannot move a folder into itself");
        }
        return;
      }
      try {
        const res = await fetch(`/api/folders/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            libraryId: props.libraryId,
            section: activeData.section,
            oldPath: result.oldPrefix,
            newPath: result.newPrefix,
          }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        props.onMutate();
      } catch (err) {
        toast.error(`Failed to move folder`);
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
              onMutate={props.onMutate}
            />
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function SectionRootDroppable({ section }: { section: ContentSection }) {
  const data: DragData = { section, kind: "section-root", folderPath: "" };
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

function folderLeafName(path: string): string {
  const segs = path.split("/").filter((s) => s.length > 0);
  return segs.length === 0 ? "" : segs[segs.length - 1];
}

function describeLeaf(d: DragData): string {
  if (d.title && d.title.trim().length > 0) return d.title;
  return d.section.slice(0, -1);
}
