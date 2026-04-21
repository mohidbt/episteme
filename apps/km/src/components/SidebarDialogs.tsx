"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { splitFolderPath, normalizeFolderPath } from "@/lib/tree";

type Section = "papers" | "references" | "notes";

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutate: () => void;
}

function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-2">{children}</div>;
}

function onEnter(fn: () => void, disabled = false) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.nativeEvent.isComposing) return;
    if (e.key !== "Enter") return;
    e.preventDefault();
    fn();
  };
}

async function jsonFetch(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(url, { ...init, headers });
}

/** ---------- Rename Folder ---------- */
interface RenameFolderDialogProps extends BaseProps {
  libraryId: number;
  section: Section;
  folderPath: string;
}
export function RenameFolderDialog({
  open,
  onOpenChange,
  onMutate,
  libraryId,
  section,
  folderPath,
}: RenameFolderDialogProps) {
  const segs = splitFolderPath(folderPath);
  const parentPath = segs.slice(0, -1).join("/");
  const currentName = segs[segs.length - 1] ?? "";
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    const newPath = normalizeFolderPath((parentPath ? parentPath + "/" : "") + trimmed);
    const r = await jsonFetch("/api/folders/rename", {
      method: "POST",
      body: JSON.stringify({ libraryId, section, oldPath: folderPath, newPath }),
    });
    setBusy(false);
    if (!r.ok) {
      toast.error("Rename failed");
      return;
    }
    toast.success("Folder renamed");
    onOpenChange(false);
    onMutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename folder</DialogTitle>
          <DialogDescription>Rename {folderPath || "/"} and all descendants.</DialogDescription>
        </DialogHeader>
        <FieldRow>
          <Label htmlFor="rename-folder-name">Folder name</Label>
          <Input
            id="rename-folder-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={onEnter(submit, busy)}
            autoFocus
          />
        </FieldRow>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ---------- Delete Folder ---------- */
interface DeleteFolderDialogProps extends BaseProps {
  libraryId: number;
  section: Section;
  folderPath: string;
}
export function DeleteFolderDialog({
  open,
  onOpenChange,
  onMutate,
  libraryId,
  section,
  folderPath,
}: DeleteFolderDialogProps) {
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const r = await jsonFetch("/api/folders/delete", {
      method: "POST",
      body: JSON.stringify({ libraryId, section, path: folderPath }),
    });
    setBusy(false);
    if (!r.ok) {
      toast.error("Delete failed");
      return;
    }
    const j = await r.json();
    toast.success(`Deleted ${j.deletedCount} item(s)`);
    onOpenChange(false);
    onMutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete folder</DialogTitle>
          <DialogDescription>
            Permanently delete {folderPath} and all items inside it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ---------- Rename Leaf ---------- */
interface RenameLeafDialogProps extends BaseProps {
  section: Section;
  id: string | number;
  currentTitle: string | null;
}
export function RenameLeafDialog({
  open,
  onOpenChange,
  onMutate,
  section,
  id,
  currentTitle,
}: RenameLeafDialogProps) {
  const [value, setValue] = useState(currentTitle ?? "");
  const [busy, setBusy] = useState(false);
  const field = section === "references" ? "citationKey" : "title";
  const label = section === "references" ? "Citation key" : "Title";
  const pathname = usePathname();
  const router = useRouter();

  async function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);

    let oldSlug: string | null = null;
    if (section === "notes") {
      const pre = await fetch(`/api/notes/${id}`);
      if (pre.ok) {
        const row = (await pre.json().catch(() => null)) as { slug?: string } | null;
        oldSlug = row?.slug ?? null;
      }
    }

    const r = await jsonFetch(`/api/${section}/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ [field]: trimmed }),
    });
    setBusy(false);
    if (!r.ok) {
      toast.error("Rename failed");
      return;
    }
    const updated = (await r.json().catch(() => null)) as { slug?: string } | null;
    toast.success("Renamed");
    onOpenChange(false);
    onMutate();

    if (
      section === "notes" &&
      oldSlug &&
      updated?.slug &&
      updated.slug !== oldSlug &&
      pathname === `/n/${oldSlug}`
    ) {
      router.replace(`/n/${updated.slug}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
        </DialogHeader>
        <FieldRow>
          <Label htmlFor="rename-leaf">{label}</Label>
          <Input
            id="rename-leaf"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            onKeyDown={onEnter(submit, busy)}
            autoFocus
          />
        </FieldRow>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ---------- Delete Leaf ---------- */
interface DeleteLeafDialogProps extends BaseProps {
  section: Section;
  id: string | number;
  title: string | null;
}
export function DeleteLeafDialog({
  open,
  onOpenChange,
  onMutate,
  section,
  id,
  title,
}: DeleteLeafDialogProps) {
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const r = await fetch(`/api/${section}/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Deleted");
    onOpenChange(false);
    onMutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete</DialogTitle>
          <DialogDescription>Permanently delete {title ?? "Untitled"}.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ---------- New Note ---------- */
interface NewNoteDialogProps extends BaseProps {
  libraryId: number;
  folderPath: string;
  /** If true, pre-writes "Untitled" as the title (used for materializing a folder). */
  defaultTitle?: string;
}
export function NewNoteDialog({
  open,
  onOpenChange,
  onMutate,
  libraryId,
  folderPath,
  defaultTitle = "",
}: NewNoteDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    const r = await jsonFetch("/api/notes", {
      method: "POST",
      body: JSON.stringify({ libraryId, folderPath, title: trimmed }),
    });
    setBusy(false);
    if (!r.ok) {
      toast.error("Create failed");
      return;
    }
    toast.success("Note created");
    onOpenChange(false);
    setTitle(defaultTitle);
    onMutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New note</DialogTitle>
          <DialogDescription>
            {folderPath ? `in ${folderPath}` : "at root"}
          </DialogDescription>
        </DialogHeader>
        <FieldRow>
          <Label htmlFor="new-note-title">Title</Label>
          <Input
            id="new-note-title"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={onEnter(submit, busy)}
            autoFocus
          />
        </FieldRow>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ---------- New Folder (notes only — materializes with Untitled note) ---------- */
interface NewFolderDialogProps extends BaseProps {
  libraryId: number;
  parentPath: string;
}
export function NewFolderDialog({
  open,
  onOpenChange,
  onMutate,
  libraryId,
  parentPath,
}: NewFolderDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    const folderPath = normalizeFolderPath((parentPath ? parentPath : "") + trimmed);
    const r = await jsonFetch("/api/notes", {
      method: "POST",
      body: JSON.stringify({ libraryId, folderPath, title: "Untitled" }),
    });
    setBusy(false);
    if (!r.ok) {
      toast.error("Create folder failed");
      return;
    }
    toast.success("Folder created");
    onOpenChange(false);
    setName("");
    onMutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            {parentPath ? `inside ${parentPath}` : "in Notes"}. Materialized with an Untitled note.
          </DialogDescription>
        </DialogHeader>
        <FieldRow>
          <Label htmlFor="new-folder-name">Folder name</Label>
          <Input
            id="new-folder-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={onEnter(submit, busy)}
            autoFocus
          />
        </FieldRow>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ---------- Move (leaf item) ---------- */
interface MoveDialogProps extends BaseProps {
  section: Section;
  id: string | number;
  currentFolderPath: string;
}
export function MoveDialog({
  open,
  onOpenChange,
  onMutate,
  section,
  id,
  currentFolderPath,
}: MoveDialogProps) {
  const [value, setValue] = useState(currentFolderPath);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const normalized = normalizeFolderPath(value);
    if (normalized === currentFolderPath) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    const r = await jsonFetch(`/api/${section}/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ folderPath: normalized }),
    });
    setBusy(false);
    if (!r.ok) {
      toast.error("Move failed");
      return;
    }
    toast.success("Moved");
    onOpenChange(false);
    onMutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to…</DialogTitle>
          <DialogDescription>
            Enter a folder path (e.g. projects/phd/). Empty = section root.
          </DialogDescription>
        </DialogHeader>
        <FieldRow>
          <Label htmlFor="move-path">Folder path</Label>
          <Input
            id="move-path"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            onKeyDown={onEnter(submit, busy)}
            placeholder="projects/phd/"
            autoFocus
          />
        </FieldRow>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ---------- Move Folder (calls /api/folders/rename) ---------- */
interface MoveFolderDialogProps extends BaseProps {
  libraryId: number;
  section: Section;
  folderPath: string;
}
export function MoveFolderDialog({
  open,
  onOpenChange,
  onMutate,
  libraryId,
  section,
  folderPath,
}: MoveFolderDialogProps) {
  const [value, setValue] = useState(folderPath);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const normalized = normalizeFolderPath(value);
    if (!normalized || normalized === folderPath) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    const r = await jsonFetch("/api/folders/rename", {
      method: "POST",
      body: JSON.stringify({ libraryId, section, oldPath: folderPath, newPath: normalized }),
    });
    setBusy(false);
    if (!r.ok) {
      toast.error("Move failed");
      return;
    }
    toast.success("Moved");
    onOpenChange(false);
    onMutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to…</DialogTitle>
          <DialogDescription>
            Enter a folder path (e.g. projects/phd/). Empty = section root.
          </DialogDescription>
        </DialogHeader>
        <FieldRow>
          <Label htmlFor="move-path">Folder path</Label>
          <Input
            id="move-path"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            onKeyDown={onEnter(submit, busy)}
            placeholder="projects/phd/"
            autoFocus
          />
        </FieldRow>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
