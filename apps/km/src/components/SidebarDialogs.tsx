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
import { maybeShowGuestError } from "@/lib/guest-error";

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
  folderId: string;
  currentName: string;
}
export function RenameFolderDialog({
  open,
  onOpenChange,
  onMutate,
  folderId,
  currentName,
}: RenameFolderDialogProps) {
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    const r = await jsonFetch(`/api/folders/${folderId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: trimmed }),
    });
    setBusy(false);
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      if (maybeShowGuestError(r, body)) return;
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
          <DialogDescription>Rename {currentName}.</DialogDescription>
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

/** ---------- Delete (Move-to-Trash) Folder ---------- */
interface DeleteFolderDialogProps extends BaseProps {
  libraryId: number;
  folderId: string;
  folderName: string;
}
export function DeleteFolderDialog({
  open,
  onOpenChange,
  onMutate,
  libraryId,
  folderId,
  folderName,
}: DeleteFolderDialogProps) {
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const r = await jsonFetch("/api/folders/trash", {
      method: "POST",
      body: JSON.stringify({
        libraryId,
        target: { kind: "folder", id: folderId },
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      if (maybeShowGuestError(r, body)) return;
      toast.error("Move to Trash failed");
      return;
    }
    toast.success("Moved to Trash");
    onOpenChange(false);
    onMutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to Trash</DialogTitle>
          <DialogDescription>
            Move folder &quot;{folderName}&quot; and all items inside it to Trash.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>Move to Trash</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ---------- Rename Leaf ---------- */
interface RenameLeafDialogProps extends BaseProps {
  section: Section;
  id: string;
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
      const body = await r.json().catch(() => null);
      if (maybeShowGuestError(r, body)) return;
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

/** ---------- Delete Leaf (Move-to-Trash) ---------- */
interface DeleteLeafDialogProps extends BaseProps {
  libraryId: number;
  section: Section;
  id: string;
  title: string | null;
}
export function DeleteLeafDialog({
  open,
  onOpenChange,
  onMutate,
  libraryId,
  section,
  id,
  title,
}: DeleteLeafDialogProps) {
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const kind = section === "papers" ? "paper" : section === "references" ? "reference" : "note";
    const r = await jsonFetch("/api/folders/trash", {
      method: "POST",
      body: JSON.stringify({
        libraryId,
        target: { kind, id },
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      if (maybeShowGuestError(r, body)) return;
      toast.error("Move to Trash failed");
      return;
    }
    toast.success("Moved to Trash");
    onOpenChange(false);
    onMutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to Trash</DialogTitle>
          <DialogDescription>
            Move &quot;{title ?? "Untitled"}&quot; to Trash.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>Move to Trash</Button>
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
      const body = await r.json().catch(() => null);
      if (maybeShowGuestError(r, body)) return;
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

/** ---------- New Folder (creates a real folder row) ---------- */
interface NewFolderDialogProps extends BaseProps {
  libraryId: number;
  parentId: string | null;
  parentName: string | null;
}
export function NewFolderDialog({
  open,
  onOpenChange,
  onMutate,
  libraryId,
  parentId,
  parentName,
}: NewFolderDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    const r = await jsonFetch("/api/folders", {
      method: "POST",
      body: JSON.stringify({ libraryId, parentId, name: trimmed }),
    });
    setBusy(false);
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      if (maybeShowGuestError(r, body)) return;
      if (r.status === 409) {
        toast.error("A folder with that name already exists");
      } else {
        toast.error("Create folder failed");
      }
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
            {parentName ? `inside ${parentName}` : "at root"}.
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

/** ---------- Move (leaf item) — sets folderId by uuid ---------- */
interface MoveDialogProps extends BaseProps {
  section: Section;
  id: string;
  currentFolderId: string | null;
}
export function MoveDialog({
  open,
  onOpenChange,
  onMutate,
  section,
  id,
  currentFolderId,
}: MoveDialogProps) {
  const [value, setValue] = useState(currentFolderId ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = value.trim();
    const nextId = trimmed.length === 0 ? null : trimmed;
    if (nextId === currentFolderId) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    const r = await jsonFetch(`/api/${section}/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ folderId: nextId }),
    });
    setBusy(false);
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      if (maybeShowGuestError(r, body)) return;
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
            Enter a folder id (UUID). Empty = library root.
          </DialogDescription>
        </DialogHeader>
        <FieldRow>
          <Label htmlFor="move-folder-id">Folder id</Label>
          <Input
            id="move-folder-id"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            onKeyDown={onEnter(submit, busy)}
            placeholder="uuid or empty for root"
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

/** ---------- Move Folder (calls /api/folders/move) ---------- */
interface MoveFolderDialogProps extends BaseProps {
  folderId: string;
  currentParentId: string | null;
}
export function MoveFolderDialog({
  open,
  onOpenChange,
  onMutate,
  folderId,
  currentParentId,
}: MoveFolderDialogProps) {
  const [value, setValue] = useState(currentParentId ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = value.trim();
    const nextParentId = trimmed.length === 0 ? null : trimmed;
    if (nextParentId === currentParentId) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    const r = await jsonFetch("/api/folders/move", {
      method: "POST",
      body: JSON.stringify({ folderId, targetParentId: nextParentId }),
    });
    setBusy(false);
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      if (maybeShowGuestError(r, body)) return;
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
            Enter a target parent folder id (UUID). Empty = library root.
          </DialogDescription>
        </DialogHeader>
        <FieldRow>
          <Label htmlFor="move-folder-parent">Target parent id</Label>
          <Input
            id="move-folder-parent"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            onKeyDown={onEnter(submit, busy)}
            placeholder="uuid or empty for root"
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
