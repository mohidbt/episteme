"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Folder as FolderIcon, FolderTree } from "lucide-react";
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
import type {
  FolderRowOut,
  NoteItem,
  PaperItem,
  ReferenceItem,
} from "@/lib/tree-server";
import { NewItemTrigger } from "./NewItemTrigger";
import { TrashNode } from "./TrashNode";

interface Props {
  libraryId: number;
  folders: FolderRowOut[];
  papers: PaperItem[];
  references: ReferenceItem[];
  notes: NoteItem[];
  trashId: string | null;
  onMutate: () => void;
}

function itemHrefFor(item: TreeItem): string {
  if (item.kind === "paper") return `/p/${item.id}`;
  if (item.kind === "reference") return `/r/${item.id}`;
  const slug = (item as TreeItem & { slug?: string }).slug;
  return `/n/${slug ?? item.id}`;
}

function itemLabel(item: TreeItem): string {
  const t = item.title;
  if (typeof t === "string" && t.trim().length > 0) return t;
  return "Untitled";
}

export function DriveTree({
  libraryId,
  folders,
  papers,
  references,
  notes,
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
    return [...p, ...r, ...n];
  }, [papers, references, notes]);

  const root = useMemo(
    () => buildFolderTree(folders, treeItems, { includeTrash: false }),
    [folders, treeItems],
  );

  // Trash badge logic: any item whose folderId is the trashId?
  const trashNonEmpty = useMemo(() => {
    if (!trashId) return false;
    return treeItems.some((it) => it.folderId === trashId);
  }, [treeItems, trashId]);

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="gap-2 text-[11px] font-medium tracking-[0.14em] uppercase text-muted-foreground">
        <FolderTree data-icon="inline-start" aria-hidden />
        Drive
      </SidebarGroupLabel>
      <NewItemTrigger
        libraryId={libraryId}
        folderId={null}
        onMutate={onMutate}
        variant="group"
      />
      <SidebarGroupContent>
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
          <TrashNode trashId={trashId} nonEmpty={trashNonEmpty} />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

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

  const ButtonComp = depth === 1 ? SidebarMenuButton : SidebarMenuSubButton;
  const Wrapper = depth === 1 ? SidebarMenuItem : SidebarMenuSubItem;

  return (
    <Wrapper>
      <ButtonComp
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={empty ? "text-muted-foreground" : ""}
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

function DriveLeafRow({ item }: { item: TreeItem }) {
  const pathname = usePathname();
  const href = itemHrefFor(item);
  const hasTitle = typeof item.title === "string" && item.title.trim().length > 0;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={href} />}
        isActive={pathname === href}
        className={`data-[active=true]:bg-transparent data-[active=true]:border-l-2 data-[active=true]:border-foreground data-[active=true]:font-medium data-[active=true]:rounded-l-none data-[active=true]:pl-[calc(0.5rem-2px)]${hasTitle ? "" : " text-muted-foreground italic"}`}
      >
        <span>{itemLabel(item)}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function DriveSubLeaf({ item }: { item: TreeItem }) {
  const pathname = usePathname();
  const href = itemHrefFor(item);
  const hasTitle = typeof item.title === "string" && item.title.trim().length > 0;
  return (
    <SidebarMenuSubButton
      render={<Link href={href} />}
      isActive={pathname === href}
      className={`data-[active=true]:bg-transparent data-[active=true]:border-l-2 data-[active=true]:border-foreground data-[active=true]:font-medium data-[active=true]:rounded-l-none data-[active=true]:pl-[calc(0.5rem-2px)]${hasTitle ? "" : " text-muted-foreground italic"}`}
    >
      <span>{itemLabel(item)}</span>
    </SidebarMenuSubButton>
  );
}
