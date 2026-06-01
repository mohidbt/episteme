"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, List, Upload } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
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
  const router = useRouter();
  const [importOpen, setImportOpen] = useState(false);
  const folderPath = folderChain.map((c) => c.name).join("/");
  const drivePillOptions = [
    { value: "/", id: "root", folderId: null, label: libraryName },
    ...folderChain.map((c, i) => ({
      value:
        "/drive/" +
        folderChain
          .slice(0, i + 1)
          .map((x) => encodeURIComponent(x.name))
          .join("/"),
      id: c.id,
      folderId: c.id,
      label: c.name,
    })),
  ];
  const currentDrivePath =
    drivePillOptions[drivePillOptions.length - 1]?.value ?? "/";

  return (
    <div
      data-testid="tour-drive-header"
      className="flex items-center justify-between gap-3 border-b border-border px-4 py-2"
    >
      <PillSwitcher
        value={currentDrivePath}
        onValueChange={(nextPath) => {
          if (nextPath !== currentDrivePath) router.push(nextPath);
        }}
        ariaLabel="Drive folder"
        className="max-w-full min-w-0 overflow-hidden"
        options={drivePillOptions.map((option, index) => ({
          value: option.value,
          ariaLabel: index === 0 ? "Drive root" : `Open ${option.label}`,
          label: (
            <DriveFolderPillLabel
              id={option.id}
              folderId={option.folderId}
              label={option.label}
              isRoot={index === 0}
              isCurrent={option.value === currentDrivePath}
            />
          ),
        }))}
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
              data-testid="tour-import-button"
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
                    Drop or choose PDFs, notes (.md), references (.bib, .ris, .csljson), or images (.jpg/.png/.webp) into this folder.
                  </DialogDescription>
                </DialogHeader>
                <UnifiedDropzone
                  libraryId={libraryId}
                  folderPath={folderPath}
                  folderId={folderId}
                  onComplete={onMutate}
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

function DriveFolderPillLabel({
  id,
  folderId,
  label,
  isRoot,
  isCurrent,
}: {
  id: string;
  folderId: string | null;
  label: string;
  isRoot: boolean;
  isCurrent: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `pill-drop:${id}`,
    data: { kind: "ancestor", folderId },
  });

  return (
    <span
      ref={setNodeRef}
      data-over={isOver ? "true" : undefined}
      className={cn(
        "block rounded-sm px-0.5 data-[over=true]:bg-primary/15 data-[over=true]:ring-1 data-[over=true]:ring-primary/60",
        !isRoot && "max-w-[200px] truncate",
      )}
    >
      {label}
    </span>
  );
}
