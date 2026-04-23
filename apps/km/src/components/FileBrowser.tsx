"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

interface Props {
  libraryId: number;
  libraryName: string;
  folderId: string | null;
  folderChain: { id: string; name: string }[];
  contents: FolderContents;
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

export function FileBrowser({
  libraryId,
  libraryName,
  folderId,
  folderChain,
  contents,
}: Props) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("tile");

  const items = useMemo(() => flatten(contents), [contents]);

  const handleOpen = (item: FileBrowserItemData) => {
    if (item.kind === "folder") {
      router.push(`/drive/${encodeURIComponent(item.title)}`);
      return;
    }
    if (item.href) router.push(item.href);
  };

  const onMutate = () => router.refresh();

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
      ) : view === "tile" ? (
        <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4 overflow-y-auto p-4">
          {items.map((item, i) => (
            <FileBrowserItem
              key={item.id}
              item={item}
              view="tile"
              index={i}
              onOpen={handleOpen}
            />
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
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
                  onOpen={handleOpen}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
