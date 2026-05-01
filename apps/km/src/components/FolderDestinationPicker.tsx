"use client";

import { ChevronDown, FolderIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  resolveChain,
  breadcrumbFromChain,
  isHiddenFolder,
  type FolderRow,
} from "@/lib/folders";

interface FolderDestinationPickerProps {
  folders: FolderRow[];
  /** Currently selected folder. `null` means library root. */
  value: string | null;
  onChange: (folderId: string | null) => void;
  rootLabel?: string;
  /** Forwarded to the trigger so tests / callers can target it. */
  triggerTestId?: string;
}

/**
 * Callback-based folder picker. Mirrors the visual language of
 * FolderFilterDropdown but does not navigate — emits onChange instead.
 */
export function FolderDestinationPicker({
  folders,
  value,
  onChange,
  rootLabel = "Library root",
  triggerTestId,
}: FolderDestinationPickerProps) {
  const visibleFolders = folders
    .filter((f) => !f.isTrash && !isHiddenFolder(folders, f.id))
    .map((f) => {
      const chain = resolveChain(folders, f.id);
      return { folder: f, breadcrumb: breadcrumbFromChain(chain) };
    })
    .sort((a, b) => a.breadcrumb.localeCompare(b.breadcrumb));

  const selected = value ? folders.find((f) => f.id === value) : null;
  const selectedChain = selected ? resolveChain(folders, selected.id) : [];
  const selectedLabel = selected
    ? breadcrumbFromChain(selectedChain)
    : rootLabel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid={triggerTestId}
        className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <FolderIcon className="size-3.5 opacity-70" aria-hidden />
        <span className="max-w-[18ch] truncate">{selectedLabel}</span>
        <ChevronDown className="size-3.5 opacity-70" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 max-h-72 overflow-y-auto">
        <DropdownMenuItem onClick={() => onChange(null)}>
          {rootLabel}
        </DropdownMenuItem>
        {visibleFolders.length > 0 && <DropdownMenuSeparator />}
        {visibleFolders.map(({ folder, breadcrumb }) => (
          <DropdownMenuItem
            key={folder.id}
            onClick={() => onChange(folder.id)}
          >
            {breadcrumb}
          </DropdownMenuItem>
        ))}
        {visibleFolders.length === 0 && (
          <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
