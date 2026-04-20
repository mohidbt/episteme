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
import type { FolderNode } from "@/lib/tree";
import type { NoteItem, PaperItem, ReferenceItem } from "@/lib/tree-server";
import { SidebarContextMenu } from "./SidebarContextMenu";
import type { DragData } from "./SidebarSection";

type ContentSection = "papers" | "references" | "notes";
type Item = PaperItem | ReferenceItem | NoteItem;

function itemHref(section: ContentSection, item: Item): string {
  if (section === "papers") return `/p/${item.id}`;
  if (section === "references") return `/r/${item.id}`;
  // notes uses slug
  return `/n/${(item as NoteItem).slug}`;
}

function itemTitle(item: Item): string {
  const t = item.title;
  if (typeof t === "string" && t.trim().length > 0) return t;
  return "Untitled";
}

function itemFolderPath(item: Item): string {
  return (item as { folder_path?: string }).folder_path ?? "";
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
  node: FolderNode<Item>;
  section: ContentSection;
  depth: number;
  libraryId: number;
  onMutate: () => void;
}

export function SidebarFolder({ node, section, depth, libraryId, onMutate }: SidebarFolderProps) {
  if (depth === 0) {
    // Root — render items + children flat, no folder row.
    return (
      <>
        {node.children.map((child) => (
          <FolderRow
            key={`folder:${section}:${child.path}`}
            node={child}
            section={section}
            depth={1}
            libraryId={libraryId}
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
  return <FolderRow node={node} section={section} depth={depth} libraryId={libraryId} onMutate={onMutate} />;
}

interface FolderRowProps {
  node: FolderNode<Item>;
  section: ContentSection;
  depth: number;
  libraryId: number;
  onMutate: () => void;
}

function FolderRow({ node, section, depth, libraryId, onMutate }: FolderRowProps) {
  const storageKey = `${libraryId}:${section}:${node.path}`;
  const [open, setOpen] = useExpanded(storageKey, false);
  const titleMuted = node.items.length === 0 && node.children.length === 0;

  const dragData: DragData = {
    section,
    kind: "folder",
    folderPath: node.path,
    title: node.folder,
  };
  const dropData: DragData = { section, kind: "folder", folderPath: node.path };
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: `drag:folder:${section}:${node.path}`, data: dragData });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:folder:${section}:${node.path}`,
    data: dropData,
  });
  const setRef = mergeRefs<HTMLButtonElement>(setDragRef, setDropRef);

  return (
    <SidebarMenuItem>
      <SidebarContextMenu
        target={{ kind: "folder", section, folderPath: node.path }}
        libraryId={libraryId}
        onMutate={onMutate}
      >
        <SidebarMenuButton
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
          <span>{node.folder}</span>
        </SidebarMenuButton>
      </SidebarContextMenu>
      {open && (node.children.length > 0 || node.items.length > 0) && (
        <SidebarMenuSub>
          {node.children.map((child) => (
            <FolderSubRow
              key={`folder:${section}:${child.path}`}
              node={child}
              section={section}
              depth={depth + 1}
              libraryId={libraryId}
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
                  folderPath: itemFolderPath(item),
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
    </SidebarMenuItem>
  );
}

function FolderSubRow({ node, section, depth, libraryId, onMutate }: FolderRowProps) {
  const storageKey = `${libraryId}:${section}:${node.path}`;
  const [open, setOpen] = useExpanded(storageKey, false);

  const dragData: DragData = {
    section,
    kind: "folder",
    folderPath: node.path,
    title: node.folder,
  };
  const dropData: DragData = { section, kind: "folder", folderPath: node.path };
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: `drag:folder:${section}:${node.path}`, data: dragData });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:folder:${section}:${node.path}`,
    data: dropData,
  });
  const setRef = mergeRefs<HTMLButtonElement>(setDragRef, setDropRef);

  return (
    <SidebarMenuSubItem>
      <SidebarContextMenu
        target={{ kind: "folder", section, folderPath: node.path }}
        libraryId={libraryId}
        onMutate={onMutate}
      >
        <SidebarMenuSubButton
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
          className={`${isDragging ? "opacity-50 " : ""}data-[over=true]:ring-1 data-[over=true]:ring-foreground/20 data-[over=true]:bg-sidebar-accent/50`}
        >
          <ChevronRight
            className={`transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          />
          <span>{node.folder}</span>
        </SidebarMenuSubButton>
      </SidebarContextMenu>
      {open && (node.children.length > 0 || node.items.length > 0) && (
        <SidebarMenuSub>
          {node.children.map((child) => (
            <FolderSubRow
              key={`folder:${section}:${child.path}`}
              node={child}
              section={section}
              depth={depth + 1}
              libraryId={libraryId}
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
                  folderPath: itemFolderPath(item),
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
    </SidebarMenuSubItem>
  );
}

interface LeafRowProps {
  item: Item;
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
    section,
    kind: "leaf",
    id: String(item.id),
    folderPath: itemFolderPath(item),
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
          folderPath: itemFolderPath(item),
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

function SubLeafLink({ item, section }: { item: Item; section: ContentSection }) {
  const pathname = usePathname();
  const href = itemHref(section, item);
  const isActive = pathname === href;
  const hasTitle = typeof item.title === "string" && item.title.trim().length > 0;

  const dragData: DragData = {
    section,
    kind: "leaf",
    id: String(item.id),
    folderPath: itemFolderPath(item),
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
