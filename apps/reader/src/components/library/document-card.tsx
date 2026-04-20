"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

interface DocumentCardProps {
  id: number;
  title: string;
  filename: string;
  pageCount: number | null;
  createdAt: string;
}

export function DocumentCard({
  id,
  title,
  filename,
  pageCount,
  createdAt,
}: DocumentCardProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const [isRenaming, startRename] = useTransition();
  const router = useRouter();

  const formattedDate = new Date(createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (!res.ok) {
        alert("Failed to delete document.");
        return;
      }
      setShowDialog(false);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  function handleRename() {
    const next = renameValue.trim();
    if (!next || next.length > 255 || next === title) {
      setShowRename(false);
      return;
    }
    startRename(async () => {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        alert("Failed to rename document.");
        return;
      }
      setShowRename(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="group relative rounded-lg border bg-card hover:border-primary/60 transition-colors">
        <Link href={`/reader/${id}`} className="block p-4">
          <div className="mb-3 h-32 rounded bg-muted flex items-center justify-center">
            <span className="text-2xl text-muted-foreground">PDF</span>
          </div>
          <p
            className="font-medium text-sm leading-snug line-clamp-2 mb-1"
            title={title}
          >
            {title}
          </p>
          <p className="text-xs text-muted-foreground">
            {pageCount != null ? `${pageCount} pages · ` : ""}
            {formattedDate}
          </p>
        </Link>

        <button
          onClick={(e) => {
            e.preventDefault();
            setRenameValue(title);
            setShowRename(true);
          }}
          className="absolute top-2 right-9 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label={`Rename ${title}`}
          data-testid="document-rename-button"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>

        <button
          onClick={(e) => {
            e.preventDefault();
            setShowDialog(true);
          }}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          aria-label={`Delete ${title}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4h6v2" />
          </svg>
        </button>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{title}&rdquo;? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRename} onOpenChange={setShowRename}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="tracking-tight">Rename document</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={255}
              autoFocus
              data-testid="document-rename-input"
              onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
              className="text-base"
            />
            <p className="text-xs text-muted-foreground font-mono truncate" title={filename}>
              {filename}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRename(false)} disabled={isRenaming}>Cancel</Button>
            <Button onClick={handleRename} disabled={isRenaming} data-testid="document-rename-submit">
              {isRenaming ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
