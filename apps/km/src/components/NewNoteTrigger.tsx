"use client";

import { useState, type MouseEvent } from "react";
import { Plus } from "lucide-react";
import { NewNoteDialog } from "./SidebarDialogs";

type Variant = "group" | "menu-item" | "sub-menu-item";

interface Props {
  libraryId: number;
  folderPath: string;
  onMutate: () => void;
  variant: Variant;
}

const BASE =
  "absolute flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground/70 outline-hidden transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-3.5 [&>svg]:shrink-0";

const VARIANT: Record<Variant, string> = {
  // Section header: sits inside SidebarGroup (relative), always visible.
  group: "top-2 right-2",
  // Folder row: sits inside SidebarMenuItem (group/menu-item); hover-revealed.
  "menu-item":
    "top-1 right-1 opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 aria-expanded:opacity-100",
  // Nested folder row: sits inside SidebarMenuSubItem (group/menu-sub-item).
  "sub-menu-item":
    "top-0.5 right-1 opacity-0 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:opacity-100 aria-expanded:opacity-100",
};

export function NewNoteTrigger({ libraryId, folderPath, onMutate, variant }: Props) {
  const [open, setOpen] = useState(false);

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        aria-label={folderPath ? `New note in ${folderPath}` : "New note"}
        onClick={onClick}
        className={`${BASE} ${VARIANT[variant]}`}
      >
        <Plus aria-hidden />
      </button>
      <NewNoteDialog
        open={open}
        onOpenChange={setOpen}
        onMutate={onMutate}
        libraryId={libraryId}
        folderPath={folderPath}
      />
    </>
  );
}
