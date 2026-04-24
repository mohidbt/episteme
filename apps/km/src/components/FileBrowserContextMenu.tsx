"use client";

import type { ReactElement, ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { FileBrowserItemData } from "@/components/FileBrowserItem";

export interface FileBrowserContextMenuHandlers {
  onOpen: (item: FileBrowserItemData) => void;
  onRename: (item: FileBrowserItemData) => void;
  onMoveTo: (item: FileBrowserItemData) => void;
  onTrash: (item: FileBrowserItemData) => void;
  onRestore: (item: FileBrowserItemData) => void;
  onDeletePermanent: (item: FileBrowserItemData) => void;
  onEmptyTrash: () => void;
}

interface Props {
  item: FileBrowserItemData;
  isInTrash: boolean;
  handlers: FileBrowserContextMenuHandlers;
  /**
   * The element the ContextMenuTrigger should render AS (e.g. <tr>, <a>, <div>).
   * Base UI's `render` prop replaces the default <div> wrapper with the provided
   * element, merging all trigger handlers (onContextMenu, ref, etc.) into it.
   * This avoids the invalid <div> between <tbody> and <tr> in list view.
   */
  render: ReactElement;
  /** Content rendered inside the trigger element. */
  children?: ReactNode;
}

export function FileBrowserContextMenu({
  item,
  isInTrash,
  handlers,
  render,
  children,
}: Props) {
  const isTrashFolder = item.kind === "folder" && item.id === "__trash__";

  return (
    <ContextMenu>
      <ContextMenuTrigger render={render}>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {isTrashFolder ? (
          // Trash folder itself → "Empty trash"
          <ContextMenuItem onClick={() => handlers.onEmptyTrash()}>
            Empty trash
          </ContextMenuItem>
        ) : isInTrash ? (
          // Leaf or folder inside trash → Restore / Delete permanently
          <>
            <ContextMenuItem onClick={() => handlers.onRestore(item)}>
              Restore
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => handlers.onDeletePermanent(item)}
            >
              Delete permanently
            </ContextMenuItem>
          </>
        ) : (
          // Normal (non-trash) context
          <>
            <ContextMenuItem onClick={() => handlers.onOpen(item)}>
              Open
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handlers.onRename(item)}>
              Rename
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handlers.onMoveTo(item)}>
              Move to…
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => handlers.onTrash(item)}
            >
              Move to Trash
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
