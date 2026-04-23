"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { useExpanded } from "@/hooks/use-expanded";
import type { FolderNode, TreeItem } from "@/lib/tree";
import type { FolderRow } from "@/lib/folders";
import { SidebarContextMenu } from "./SidebarContextMenu";
import { NewItemTrigger } from "./NewItemTrigger";
import type { DragData } from "./SidebarSection";

type ContentSection = "papers" | "references" | "notes";

function itemHref(section: ContentSection, item: TreeItem): string {
  if (section === "papers") return `/p/${item.id}`;
  if (section === "references") return `/r/${item.id}`;
  // Notes uses slug; TreeItem doesn't carry slug, so fall back to id.
  // (NoteItem does carry slug, which we stash via an extended shape below.)
  const slug = (item as TreeItem & { slug?: string }).slug;
  return `/n/${slug ?? item.id}`;
}

function itemTitle(item: TreeItem): string {
  const t = item.title;
  if (typeof t === "string" && t.trim().length > 0) return t;
  return "Untitled";
}

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(node);
      else (ref as React.RefObject<T | null>).current = node;
    }
  };
}

interface SidebarFolderProps {
  node: FolderNode;
  section: ContentSection;
  depth: number;
  libraryId: number;
  allFolders: FolderRow[];
  onMutate: () => void;
}

export function SidebarFolder({
  node,
  section,
  depth,
  libraryId,
  allFolders,
  onMutate,
}: SidebarFolderProps) {
  if (depth === 0) {
    // Root — render children + items flat, no folder row.
    return (
      <>
        {node.children.map((child) => (
          <FolderRowView
            key={`folder:${section}:${child.folder?.id ?? "root"}`}
            node={child}
            section={section}
            depth={1}
            libraryId={libraryId}
            allFolders={allFolders}
            onMutate={onMutate}
          />
        ))}
        {node.items.map((item) => (
          <LeafRow
            key={`leaf:${section}:${item.id}`}
            item={item}
            section={section}
            libraryId={libraryId}
            onMutate={onMutate}
          />
        ))}
      </>
    );
  }
  return (
    <FolderRowView
      node={node}
      section={section}
      depth={depth}
      libraryId={libraryId}
      allFolders={allFolders}
      onMutate={onMutate}
    />
  );
}

interface FolderRowProps {
  node: FolderNode;
  section: ContentSection;
  depth: number;
  libraryId: number;
  allFolders: FolderRow[];
  onMutate: () => void;
}

function FolderRowView({
  node,
  section,
  depth,
  libraryId,
  allFolders,
  onMutate,
}: FolderRowProps) {
  // Every non-root FolderNode has a concrete folder.
  const folder = node.folder!;
  const storageKey = `${libraryId}:${section}:${folder.id}`;
  const [open, setOpen] = useExpanded(storageKey, false);
  const titleMuted = node.items.length === 0 && node.children.length === 0;

  const dragData: DragData = {
    kind: "folder",
    id: folder.id,
    folderId: folder.id,
    title: folder.name,
  };
  const dropData: DragData = {
    kind: "folder",
    id: folder.id,
    folderId: folder.id,
  };
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: `drag:folder:${section}:${folder.id}`, data: dragData });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:folder:${section}:${folder.id}`,
    data: dropData,
  });
  const setRef = mergeRefs<HTMLButtonElement>(setDragRef, setDropRef);

  const ButtonComp = depth === 1 ? SidebarMenuButton : SidebarMenuSubButton;
  const Wrapper = depth === 1 ? SidebarMenuItem : SidebarMenuSubItem;

  return (
    <Wrapper>
      <SidebarContextMenu
        target={{
          kind: "folder",
          section,
          folderId: folder.id,
          folderName: folder.name,
          folderPath: node.path,
        }}
        libraryId={libraryId}
        onMutate={onMutate}
      >
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
          className={`${titleMuted ? "text-muted-foreground" : ""}${isDragging ? " opacity-50" : ""} data-[over=true]:ring-1 data-[over=true]:ring-foreground/20 data-[over=true]:bg-sidebar-accent/50`}
        >
          <ChevronRight
            className={`transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          />
          <span>{folder.name}</span>
        </ButtonComp>
      </SidebarContextMenu>
      {section === "notes" && (
        <NewItemTrigger
          libraryId={libraryId}
          folderId={folder.id}
          onMutate={onMutate}
          variant={depth === 1 ? "menu-item" : "sub-menu-item"}
        />
      )}
      {open && (node.children.length > 0 || node.items.length > 0) && (
        <SidebarMenuSub>
          {node.children.map((child) => (
            <FolderRowView
              key={`folder:${section}:${child.folder?.id ?? "x"}`}
              node={child}
              section={section}
              depth={depth + 1}
              libraryId={libraryId}
              allFolders={allFolders}
              onMutate={onMutate}
            />
          ))}
          {node.items.map((item) => (
            <SidebarMenuSubItem key={`leaf:${section}:${item.id}`}>
              <SidebarContextMenu
                target={{
                  kind: "leaf",
                  section,
                  id: item.id,
                  folderId: item.folderId,
                  title: item.title,
                }}
                libraryId={libraryId}
                onMutate={onMutate}
              >
                <SubLeafLink item={item} section={section} />
              </SidebarContextMenu>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </Wrapper>
  );
}

interface LeafRowProps {
  item: TreeItem;
  section: ContentSection;
  libraryId: number;
  onMutate: () => void;
}

function LeafRow({ item, section, libraryId, onMutate }: LeafRowProps) {
  const pathname = usePathname();
  const href = itemHref(section, item);
  const isActive = pathname === href;
  const hasTitle = typeof item.title === "string" && item.title.trim().length > 0;

  const dragData: DragData = {
    kind: "leaf",
    itemKind: item.kind,
    id: item.id,
    folderId: item.folderId,
    title: item.title ?? undefined,
  };
  const {
    setNodeRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: `drag:leaf:${section}:${item.id}`, data: dragData });

  return (
    <SidebarMenuItem>
      <SidebarContextMenu
        target={{
          kind: "leaf",
          section,
          id: item.id,
          folderId: item.folderId,
          title: item.title,
        }}
        libraryId={libraryId}
        onMutate={onMutate}
      >
        <SidebarMenuButton
          render={
            <Link
              href={href}
              ref={setNodeRef}
              {...attributes}
              {...listeners}
            />
          }
          isActive={isActive}
          className={`data-[active=true]:bg-transparent data-[active=true]:border-l-2 data-[active=true]:border-foreground data-[active=true]:font-medium data-[active=true]:rounded-l-none data-[active=true]:pl-[calc(0.5rem-2px)]${hasTitle ? "" : " text-muted-foreground italic"}${isDragging ? " opacity-50" : ""}`}
        >
          <span>{itemTitle(item)}</span>
        </SidebarMenuButton>
      </SidebarContextMenu>
    </SidebarMenuItem>
  );
}

function SubLeafLink({ item, section }: { item: TreeItem; section: ContentSection }) {
  const pathname = usePathname();
  const href = itemHref(section, item);
  const isActive = pathname === href;
  const hasTitle = typeof item.title === "string" && item.title.trim().length > 0;

  const dragData: DragData = {
    kind: "leaf",
    itemKind: item.kind,
    id: item.id,
    folderId: item.folderId,
    title: item.title ?? undefined,
  };
  const {
    setNodeRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: `drag:leaf:${section}:${item.id}`, data: dragData });

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
      isActive={isActive}
      className={`data-[active=true]:bg-transparent data-[active=true]:border-l-2 data-[active=true]:border-foreground data-[active=true]:font-medium data-[active=true]:rounded-l-none data-[active=true]:pl-[calc(0.5rem-2px)]${hasTitle ? "" : " text-muted-foreground italic"}${isDragging ? " opacity-50" : ""}`}
    >
      <span>{itemTitle(item)}</span>
    </SidebarMenuSubButton>
  );
}
