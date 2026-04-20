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
    const parentPath = target.kind === "folder" ? target.folderPath : "";
    return (
      <NewFolderDialog
        open={open}
        onOpenChange={onOpenChange}
        onMutate={onMutate}
        libraryId={libraryId}
        parentPath={parentPath}
      />
    );
  }

  if (dialog === "new-note") {
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
        libraryId={libraryId}
        section={target.section}
        folderPath={target.folderPath}
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
        section={target.section}
        folderPath={target.folderPath}
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
        section={target.section}
        id={target.id}
        title={target.title}
      />
    );
  }

  if (dialog === "move") {
    if (target.kind === "folder") {
      return (
        <MoveFolderDialog
          open={open}
          onOpenChange={onOpenChange}
          onMutate={onMutate}
          libraryId={libraryId}
          section={target.section}
          folderPath={target.folderPath}
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
          currentFolderPath={target.folderPath}
        />
      );
    }
  }

  return null;
}
