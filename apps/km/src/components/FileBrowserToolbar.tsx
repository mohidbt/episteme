"use client";

import Link from "next/link";
import { LayoutGrid, List, Upload, ChevronRight } from "lucide-react";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { NewItemTrigger } from "@/components/NewItemTrigger";

export type ViewMode = "tile" | "list";

export interface ToolbarProps {
  libraryId: number;
  libraryName: string;
  folderId: string | null;
  folderChain: { id: string; name: string }[];
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  onMutate: () => void;
}

export function FileBrowserToolbar({
  libraryId,
  libraryName,
  folderId,
  folderChain,
  view,
  onViewChange,
  onMutate,
}: ToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
      <nav
        aria-label="Breadcrumbs"
        className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground"
      >
        <Link
          href="/drive"
          className="truncate font-medium text-foreground hover:underline"
        >
          {libraryName}
        </Link>
        {folderChain.map((c, i) => {
          const path =
            "/drive/" +
            folderChain
              .slice(0, i + 1)
              .map((x) => encodeURIComponent(x.name))
              .join("/");
          return (
            <span key={c.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight aria-hidden className="size-3.5 shrink-0" />
              <Link
                href={path}
                className="truncate hover:text-foreground hover:underline"
              >
                {c.name}
              </Link>
            </span>
          );
        })}
      </nav>

      <div className="flex items-center gap-2">
        <ToggleGroup
          value={[view]}
          onValueChange={(vals) => {
            const next = vals[0] as ViewMode | undefined;
            if (next) onViewChange(next);
          }}
          aria-label="View mode"
        >
          <ToggleGroupItem
            value="tile"
            aria-label="Tile view"
            data-testid="fb-view-tile"
          >
            <LayoutGrid aria-hidden className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="list"
            aria-label="List view"
            data-testid="fb-view-list"
          >
            <List aria-hidden className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>

        <NewItemTrigger
          libraryId={libraryId}
          folderId={folderId}
          variant="toolbar"
          onMutate={onMutate}
        />

        {/* TODO(T21): wire to PaperUploadDropzone with folder target. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            /* no-op in T16 */
          }}
        >
          <Upload aria-hidden className="size-3.5" />
          Import
        </Button>
      </div>
    </div>
  );
}
