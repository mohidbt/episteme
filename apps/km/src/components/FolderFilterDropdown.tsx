"use client";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resolveChain, breadcrumbFromChain, type FolderRow } from "@/lib/folders";

interface FolderFilterDropdownProps {
  folders: FolderRow[];
  activeFolderId: string | null;
  /** The base URL path to filter, e.g. "/papers" or "/references" */
  basePath: string;
}

export function FolderFilterDropdown({
  folders,
  activeFolderId,
  basePath,
}: FolderFilterDropdownProps) {
  const router = useRouter();

  const nonTrashFolders = folders
    .filter((f) => !f.isTrash)
    .map((f) => {
      const chain = resolveChain(folders, f.id);
      return { folder: f, breadcrumb: breadcrumbFromChain(chain) };
    })
    .sort((a, b) => a.breadcrumb.localeCompare(b.breadcrumb));

  const activeFolder = activeFolderId
    ? folders.find((f) => f.id === activeFolderId)
    : null;

  const label = activeFolder ? activeFolder.name : "Filter by folder";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground">
        {label}
        <ChevronDown className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 max-h-72 overflow-y-auto">
        {activeFolderId && (
          <>
            <DropdownMenuItem onClick={() => router.push(basePath)}>
              All folders
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {nonTrashFolders.map(({ folder, breadcrumb }) => (
          <DropdownMenuItem
            key={folder.id}
            onClick={() => router.push(`${basePath}?folder=${folder.id}`)}
          >
            {breadcrumb}
          </DropdownMenuItem>
        ))}
        {nonTrashFolders.length === 0 && (
          <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
