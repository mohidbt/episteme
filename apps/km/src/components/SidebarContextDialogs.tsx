"use client";

import type { ReactNode } from "react";
import {
  DeleteFolderDialog,
  DeleteLeafDialog,
  MoveDialog,
  MoveFolderDialog,
  NewFolderDialog,
  NewNoteDialog,
  RenameFolderDialog,
  RenameLeafDialog,
} from "./SidebarDialogs";
import type { ContextTarget, DialogKind } from "./SidebarContextMenu";

interface Args {
  dialog: DialogKind;
  target: ContextTarget;
  libraryId: number;
  onMutate: () => void;
  close: () => void;
}

export function renderContextDialog({
  dialog,
  target,
  libraryId,
  onMutate,
  close,
}: Args): ReactNode {
  if (!dialog) return null;
  const open = true;
  const onOpenChange = (next: boolean) => {
    if (!next) close();
  };

  if (dialog === "new-folder") {
    const parentId = target.kind === "folder" ? target.folderId : null;
    const parentName = target.kind === "folder" ? target.folderName : null;
    return (
      <NewFolderDialog
        open={open}
        onOpenChange={onOpenChange}
        onMutate={onMutate}
        libraryId={libraryId}
        parentId={parentId}
        parentName={parentName}
      />
    );
  }

  if (dialog === "new-note") {
    // /api/notes POST still takes folderPath (legacy shim); T14 unifies.
    const folderPath = target.kind === "folder" ? target.folderPath : "";
    return (
      <NewNoteDialog
        open={open}
        onOpenChange={onOpenChange}
        onMutate={onMutate}
        libraryId={libraryId}
        folderPath={folderPath}
      />
    );
  }

  if (dialog === "rename-folder" && target.kind === "folder") {
    return (
      <RenameFolderDialog
        open={open}
        onOpenChange={onOpenChange}
        onMutate={onMutate}
        folderId={target.folderId}
        currentName={target.folderName}
      />
    );
  }

  if (dialog === "delete-folder" && target.kind === "folder") {
    return (
      <DeleteFolderDialog
        open={open}
        onOpenChange={onOpenChange}
        onMutate={onMutate}
        libraryId={libraryId}
        folderId={target.folderId}
        folderName={target.folderName}
      />
    );
  }

  if (dialog === "rename-leaf" && target.kind === "leaf") {
    return (
      <RenameLeafDialog
        open={open}
        onOpenChange={onOpenChange}
        onMutate={onMutate}
        section={target.section}
        id={target.id}
        currentTitle={target.title}
      />
    );
  }

  if (dialog === "delete-leaf" && target.kind === "leaf") {
    return (
      <DeleteLeafDialog
        open={open}
        onOpenChange={onOpenChange}
        onMutate={onMutate}
        libraryId={libraryId}
        section={target.section}
        id={target.id}
        title={target.title}
      />
    );
  }

  if (dialog === "move") {
    if (target.kind === "folder") {
      // currentParentId not surfaced to the context target — pass null as the
      // default; the dialog is a raw-uuid input (T14 replaces with a picker).
      return (
        <MoveFolderDialog
          open={open}
          onOpenChange={onOpenChange}
          onMutate={onMutate}
          folderId={target.folderId}
          currentParentId={null}
        />
      );
    }
    if (target.kind === "leaf") {
      return (
        <MoveDialog
          open={open}
          onOpenChange={onOpenChange}
          onMutate={onMutate}
          section={target.section}
          id={target.id}
          currentFolderId={target.folderId}
        />
      );
    }
  }

  return null;
}
