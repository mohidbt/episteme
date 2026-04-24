"use client";

import { useState } from "react";
import { LayoutGrid, List, Upload } from "lucide-react";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NewItemTrigger } from "@/components/NewItemTrigger";
import { PaperUploadDropzone } from "@/components/PaperUploadDropzone";
import { PathPill } from "@/components/PathPill";

export type ViewMode = "tile" | "list";

export interface ToolbarProps {
  libraryId: number;
  libraryName: string;
  folderId: string | null;
  folderChain: { id: string; name: string }[];
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  onMutate: () => void;
  isTrashView?: boolean;
  onEmptyTrash?: () => void;
  trashCount?: number;
}

export function FileBrowserToolbar({
  libraryId,
  libraryName,
  folderId,
  folderChain,
  view,
  onViewChange,
  onMutate,
  isTrashView = false,
  onEmptyTrash,
  trashCount = 0,
}: ToolbarProps) {
  const [importOpen, setImportOpen] = useState(false);
  const folderPath = folderChain.map((c) => c.name).join("/");
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
      <PathPill
        segments={[
          { id: "root", label: libraryName, href: "/" },
          ...folderChain.map((c, i) => ({
            id: c.id,
            label: c.name,
            href:
              "/drive/" +
              folderChain
                .slice(0, i + 1)
                .map((x) => encodeURIComponent(x.name))
                .join("/"),
          })),
        ]}
      />

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

        {isTrashView ? (
          <>
            <Badge variant="secondary">In Trash</Badge>
            <Button
              variant="destructive"
              size="sm"
              onClick={onEmptyTrash}
              disabled={trashCount === 0}
            >
              Empty trash
            </Button>
          </>
        ) : (
          <>
            <NewItemTrigger
              libraryId={libraryId}
              folderId={folderId}
              variant="toolbar"
              onMutate={onMutate}
            />

            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
            >
              <Upload aria-hidden className="size-3.5" />
              Import
            </Button>
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Import papers</DialogTitle>
                  <DialogDescription>
                    Drop or choose PDF files to upload into this folder.
                  </DialogDescription>
                </DialogHeader>
                <PaperUploadDropzone
                  libraryId={libraryId}
                  folderPath={folderPath}
                  folderId={folderId}
                />
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setImportOpen(false);
                      onMutate();
                    }}
                  >
                    Done
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </div>
  );
}
