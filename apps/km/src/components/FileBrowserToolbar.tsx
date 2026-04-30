"use client";

import { useState } from "react";
import { LayoutGrid, List, Upload } from "lucide-react";
import { PillSwitcher } from "@/components/ui/PillSwitcher";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NewItemTrigger } from "@/components/NewItemTrigger";
import { UnifiedDropzone } from "@/components/UnifiedDropzone";
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
        segmentDropTargets
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
        <PillSwitcher<ViewMode>
          value={view}
          onValueChange={onViewChange}
          ariaLabel="View mode"
          options={[
            {
              value: "tile",
              ariaLabel: "Tile view",
              testId: "fb-view-tile",
              label: <LayoutGrid aria-hidden className="size-4" />,
            },
            {
              value: "list",
              ariaLabel: "List view",
              testId: "fb-view-list",
              label: <List aria-hidden className="size-4" />,
            },
          ]}
        />

        {isTrashView ? (
          <>
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
                  <DialogTitle>Import files</DialogTitle>
                  <DialogDescription>
                    Drop or choose PDF, .md, or .bib files into this folder.
                  </DialogDescription>
                </DialogHeader>
                <UnifiedDropzone
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
