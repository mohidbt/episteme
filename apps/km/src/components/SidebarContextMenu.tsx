"use client";

import { useState, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { renderContextDialog } from "./SidebarContextDialogs";

type Section = "papers" | "references" | "notes";

export type ContextTarget =
  | { kind: "section-header"; section: Section }
  | { kind: "folder"; section: Section; folderPath: string }
  | {
      kind: "leaf";
      section: Section;
      id: string | number;
      folderPath: string;
      title: string | null;
    };

export type DialogKind =
  | null
  | "new-folder"
  | "new-note"
  | "rename-folder"
  | "delete-folder"
  | "rename-leaf"
  | "delete-leaf"
  | "move";

interface Props {
  target: ContextTarget;
  libraryId: number;
  onMutate: () => void;
  children: ReactNode;
}

export function SidebarContextMenu({ target, libraryId, onMutate, children }: Props) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const close = () => setDialog(null);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={<div />}>{children}</ContextMenuTrigger>
        <ContextMenuContent>{renderItems(target, setDialog)}</ContextMenuContent>
      </ContextMenu>

      {renderContextDialog({ dialog, target, libraryId, onMutate, close })}
    </>
  );
}

function renderItems(target: ContextTarget, open: (d: DialogKind) => void): ReactNode {
  if (target.kind === "section-header") {
    // P0: hide "New folder" on papers/references; only notes gets both.
    if (target.section !== "notes") return null;
    return (
      <>
        <ContextMenuItem onClick={() => open("new-folder")}>New folder</ContextMenuItem>
        <ContextMenuItem onClick={() => open("new-note")}>New note</ContextMenuItem>
      </>
    );
  }

  if (target.kind === "folder") {
    const isNotes = target.section === "notes";
    return (
      <>
        {isNotes && (
          <ContextMenuItem onClick={() => open("new-folder")}>New subfolder</ContextMenuItem>
        )}
        {isNotes && (
          <ContextMenuItem onClick={() => open("new-note")}>New note</ContextMenuItem>
        )}
        {isNotes && <ContextMenuSeparator />}
        <ContextMenuItem onClick={() => open("rename-folder")}>Rename folder</ContextMenuItem>
        <ContextMenuItem onClick={() => open("move")}>Move to…</ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={() => open("delete-folder")}>
          Delete folder
        </ContextMenuItem>
      </>
    );
  }

  return (
    <>
      <ContextMenuItem onClick={() => open("rename-leaf")}>Rename</ContextMenuItem>
      <ContextMenuItem onClick={() => open("move")}>Move to…</ContextMenuItem>
      <ContextMenuItem variant="destructive" onClick={() => open("delete-leaf")}>
        Delete
      </ContextMenuItem>
    </>
  );
}
