"use client";

import {
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { validateFolderName } from "@/lib/folders";

type Variant = "group" | "menu-item" | "sub-menu-item" | "toolbar";

interface Props {
  libraryId: number;
  folderId: string | null;
  onMutate: () => void;
  variant?: Variant;
}

const BASE_ICON =
  "absolute flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground/70 outline-hidden transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-3.5 [&>svg]:shrink-0";

const VARIANT_CLASS: Record<Exclude<Variant, "toolbar">, string> = {
  group: "top-2 right-2",
  "menu-item":
    "top-1 right-1 opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 aria-expanded:opacity-100",
  "sub-menu-item":
    "top-0.5 right-1 opacity-0 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:opacity-100 aria-expanded:opacity-100",
};

type DialogKind = "note" | "reference" | "folder" | null;

async function jsonFetch(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  return fetch(url, { ...init, headers });
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

export function NewItemTrigger({
  libraryId,
  folderId,
  onMutate,
  variant = "menu-item",
}: Props) {
  const [dialog, setDialog] = useState<DialogKind>(null);

  const stop = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const triggerClass =
    variant === "toolbar"
      ? "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-accent"
      : `${BASE_ICON} ${VARIANT_CLASS[variant]}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="New"
              onClick={stop}
              className={triggerClass}
            >
              {variant === "toolbar" ? (
                <>
                  <Plus aria-hidden className="size-3.5" />
                  <span>New</span>
                </>
              ) : (
                <Plus aria-hidden />
              )}
            </button>
          }
        />
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => setDialog("note")}>
            Note
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("reference")}>
            Reference
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("folder")}>
            Folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NoteCreateDialog
        open={dialog === "note"}
        onOpenChange={(o) => setDialog(o ? "note" : null)}
        libraryId={libraryId}
        folderId={folderId}
        onMutate={onMutate}
      />
      <ReferenceCreateDialog
        open={dialog === "reference"}
        onOpenChange={(o) => setDialog(o ? "reference" : null)}
        libraryId={libraryId}
        folderId={folderId}
        onMutate={onMutate}
      />
      <FolderCreateDialog
        open={dialog === "folder"}
        onOpenChange={(o) => setDialog(o ? "folder" : null)}
        libraryId={libraryId}
        parentId={folderId}
        onMutate={onMutate}
      />
    </>
  );
}

/* ---------- Note ---------- */

interface NoteDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  libraryId: number;
  folderId: string | null;
  onMutate: () => void;
}

function NoteCreateDialog({
  open,
  onOpenChange,
  libraryId,
  folderId,
  onMutate,
}: NoteDialogProps) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    const r = await jsonFetch("/api/notes", {
      method: "POST",
      body: JSON.stringify({ libraryId, folderId, title: trimmed }),
    });
    setBusy(false);
    if (!r.ok) {
      toast.error("Create failed");
      return;
    }
    toast.success("Note created");
    onOpenChange(false);
    setTitle("");
    onMutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New note</DialogTitle>
          <DialogDescription>Create a note in this folder.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="new-item-note-title">Title</Label>
          <Input
            id="new-item-note-title"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={onEnter(submit, busy)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Reference ---------- */

function ReferenceCreateDialog({
  open,
  onOpenChange,
  libraryId,
  folderId,
  onMutate,
}: NoteDialogProps) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = key.trim();
    if (!trimmed) return;
    setBusy(true);
    const r = await jsonFetch("/api/references", {
      method: "POST",
      body: JSON.stringify({
        libraryId,
        folderId,
        citationKey: trimmed,
        cslJson: {},
      }),
    });
    setBusy(false);
    if (!r.ok) {
      toast.error("Create failed");
      return;
    }
    toast.success("Reference created");
    onOpenChange(false);
    setKey("");
    onMutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New reference</DialogTitle>
          <DialogDescription>Enter a citation key.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="new-item-ref-key">Citation key</Label>
          <Input
            id="new-item-ref-key"
            value={key}
            onChange={(e) => setKey(e.currentTarget.value)}
            onKeyDown={onEnter(submit, busy)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Folder ---------- */

interface FolderDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  libraryId: number;
  parentId: string | null;
  onMutate: () => void;
}

function FolderCreateDialog({
  open,
  onOpenChange,
  libraryId,
  parentId,
  onMutate,
}: FolderDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    const err = validateFolderName(trimmed);
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    const r = await jsonFetch("/api/folders", {
      method: "POST",
      body: JSON.stringify({ libraryId, parentId, name: trimmed }),
    });
    setBusy(false);
    if (!r.ok) {
      if (r.status === 409) toast.error("A folder with that name already exists");
      else toast.error("Create folder failed");
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
          <DialogDescription>Create a folder here.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="new-item-folder-name">Folder name</Label>
          <Input
            id="new-item-folder-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={onEnter(submit, busy)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
