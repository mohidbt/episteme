"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
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

interface SidebarFolderProps {
  node: FolderNode<Item>;
  section: ContentSection;
  depth: number;
  libraryId: number;
}

export function SidebarFolder({ node, section, depth, libraryId }: SidebarFolderProps) {
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
          />
        ))}
        {node.items.map((item) => (
          <LeafRow key={`leaf:${section}:${item.id}`} item={item} section={section} />
        ))}
      </>
    );
  }
  return <FolderRow node={node} section={section} depth={depth} libraryId={libraryId} />;
}

interface FolderRowProps {
  node: FolderNode<Item>;
  section: ContentSection;
  depth: number;
  libraryId: number;
}

function FolderRow({ node, section, depth, libraryId }: FolderRowProps) {
  const storageKey = `${libraryId}:${section}:${node.path}`;
  const [open, setOpen] = useExpanded(storageKey, false);
  const titleMuted = node.items.length === 0 && node.children.length === 0;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={titleMuted ? "text-muted-foreground" : undefined}
      >
        <ChevronRight
          className={`transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
        <span>{node.folder}</span>
      </SidebarMenuButton>
      {open && (node.children.length > 0 || node.items.length > 0) && (
        <SidebarMenuSub>
          {node.children.map((child) => (
            <FolderSubRow
              key={`folder:${section}:${child.path}`}
              node={child}
              section={section}
              depth={depth + 1}
              libraryId={libraryId}
            />
          ))}
          {node.items.map((item) => (
            <SidebarMenuSubItem key={`leaf:${section}:${item.id}`}>
              <SubLeafLink item={item} section={section} />
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

function FolderSubRow({ node, section, depth, libraryId }: FolderRowProps) {
  const storageKey = `${libraryId}:${section}:${node.path}`;
  const [open, setOpen] = useExpanded(storageKey, false);

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        render={<button type="button" />}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <ChevronRight
          className={`transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
        <span>{node.folder}</span>
      </SidebarMenuSubButton>
      {open && (node.children.length > 0 || node.items.length > 0) && (
        <SidebarMenuSub>
          {node.children.map((child) => (
            <FolderSubRow
              key={`folder:${section}:${child.path}`}
              node={child}
              section={section}
              depth={depth + 1}
              libraryId={libraryId}
            />
          ))}
          {node.items.map((item) => (
            <SidebarMenuSubItem key={`leaf:${section}:${item.id}`}>
              <SubLeafLink item={item} section={section} />
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuSubItem>
  );
}

function LeafRow({ item, section }: { item: Item; section: ContentSection }) {
  const pathname = usePathname();
  const href = itemHref(section, item);
  const isActive = pathname === href;
  const hasTitle = typeof item.title === "string" && item.title.trim().length > 0;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={href} />}
        isActive={isActive}
        className={`data-[active=true]:bg-transparent data-[active=true]:border-l-2 data-[active=true]:border-foreground data-[active=true]:font-medium data-[active=true]:rounded-l-none data-[active=true]:pl-[calc(0.5rem-2px)]${hasTitle ? "" : " text-muted-foreground italic"}`}
      >
        <span>{itemTitle(item)}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SubLeafLink({ item, section }: { item: Item; section: ContentSection }) {
  const pathname = usePathname();
  const href = itemHref(section, item);
  const isActive = pathname === href;
  const hasTitle = typeof item.title === "string" && item.title.trim().length > 0;
  return (
    <SidebarMenuSubButton
      render={<Link href={href} />}
      isActive={isActive}
      className={`data-[active=true]:bg-transparent data-[active=true]:border-l-2 data-[active=true]:border-foreground data-[active=true]:font-medium data-[active=true]:rounded-l-none data-[active=true]:pl-[calc(0.5rem-2px)]${hasTitle ? "" : " text-muted-foreground italic"}`}
    >
      <span>{itemTitle(item)}</span>
    </SidebarMenuSubButton>
  );
}
