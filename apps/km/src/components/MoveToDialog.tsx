"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type FolderRow,
  resolveChain,
  breadcrumbFromChain,
} from "@/lib/folders";

export interface MoveToDialogProps {
  libraryId: number;
  folders: FolderRow[];
  currentFolderId: string | null;
  excludeFolderId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (targetFolderId: string | null) => Promise<void>;
  title?: string;
  description?: string;
}

export function MoveToDialog({
  folders,
  currentFolderId,
  excludeFolderId,
  open,
  onOpenChange,
  onMove,
  title = "Move to folder",
  description = "Pick a destination folder for this item.",
}: MoveToDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(
    () => new Map(folders.map((f) => [f.id, f])),
    [folders],
  );

  function isInSubtree(id: string, root: string): boolean {
    let cur: string | null = id;
    while (cur) {
      if (cur === root) return true;
      cur = byId.get(cur)?.parentId ?? null;
    }
    return false;
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return folders
      .filter(
        (f) =>
          !f.isTrash &&
          f.id !== currentFolderId &&
          (!excludeFolderId || !isInSubtree(f.id, excludeFolderId)),
      )
      .map((f) => {
        const chain = resolveChain(folders, f.id);
        return {
          folder: f,
          depth: Math.max(0, chain.length - 1),
          breadcrumb: breadcrumbFromChain(chain),
        };
      })
      .filter(({ folder, breadcrumb }) => {
        if (!q) return true;
        return (
          folder.name.toLowerCase().includes(q) ||
          breadcrumb.toLowerCase().includes(q)
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, query, currentFolderId, excludeFolderId]);

  async function handleMove() {
    setBusy(true);
    try {
      await onMove(selectedId);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Input
          data-testid="move-search-input"
          placeholder="Search folders..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div
          role="listbox"
          aria-label="Destination folders"
          className="max-h-64 overflow-y-auto rounded-md border"
        >
          <button
            type="button"
            role="option"
            aria-selected={selectedId === null}
            data-testid="move-item-root"
            onClick={() => setSelectedId(null)}
            className={
              "flex w-full items-center px-3 py-2 text-left text-sm hover:bg-muted " +
              (selectedId === null ? "bg-muted" : "")
            }
          >
            Library root
          </button>
          {visible.map(({ folder, depth, breadcrumb }) => (
            <button
              type="button"
              role="option"
              aria-selected={selectedId === folder.id}
              key={folder.id}
              data-testid={`move-item-${folder.id}`}
              title={breadcrumb}
              onClick={() => setSelectedId(folder.id)}
              className={
                "flex w-full items-center px-3 py-2 text-left text-sm hover:bg-muted " +
                (selectedId === folder.id ? "bg-muted" : "")
              }
              style={{ paddingLeft: `${12 + depth * 16}px` }}
            >
              {folder.name}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            data-testid="move-confirm"
            onClick={handleMove}
            disabled={busy}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
