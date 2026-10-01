"use client";

import { useCallback, useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTabs } from "@/components/TabBar";
import { NotePicker, type PickedNote } from "./NotePicker";
import { PanelNote } from "./PanelNote";

/**
 * The reader's notes dock panel: a header row (note picker, sync dot, open in
 * tab, dock menu) over either the chosen note or, with none chosen, the
 * picker itself.
 */
export function ReaderNotesPanel({
  paperTitle,
  libraryId,
  folderId,
  noteId,
  onNoteIdChange,
  dockControl,
}: {
  paperTitle: string;
  libraryId: number;
  folderId: string | null;
  /** The paper's remembered note. */
  noteId: string | null;
  onNoteIdChange: (noteId: string | null) => void;
  dockControl: ReactNode;
}) {
  const { openInNewTab } = useTabs();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Title and slug for the header, known once a note is picked or loaded.
  const [note, setNote] = useState<PickedNote | null>(null);
  // A note chosen in this visit takes focus; a remembered one does not, so
  // PDF keyboard scrolling keeps working after a reload.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const current = note?.id === noteId ? note : null;

  const pick = (picked: PickedNote) => {
    setPickerOpen(false);
    setNote(picked);
    setPickedId(picked.id);
    onNoteIdChange(picked.id);
  };

  const clearNote = useCallback(() => onNoteIdChange(null), [onNoteIdChange]);

  const picker = (
    <NotePicker paperTitle={paperTitle} libraryId={libraryId} folderId={folderId} onPick={pick} />
  );

  return (
    <div className="flex h-full w-full flex-col bg-background" data-testid="reader-notes-panel">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                data-testid="note-picker-trigger"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold outline-none"
              >
                <span className="truncate">{current?.title ?? "Choose a note"}</span>
                <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            }
          />
          <PopoverContent align="start" className="p-0" data-testid="note-picker-popover">
            {picker}
          </PopoverContent>
        </Popover>
        {current && (
          <>
            <span
              role="status"
              aria-label={saving ? "Saving" : "Synced"}
              data-testid="reader-notes-sync"
              data-sync-status={saving ? "saving" : "synced"}
              className={`size-1.5 shrink-0 rounded-full ${saving ? "bg-amber-500" : "bg-green-500"}`}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open in tab"
              title="Open in tab"
              data-testid="reader-notes-open-in-tab"
              onClick={() =>
                openInNewTab(`/n/${encodeURIComponent(current.slug)}`, current.title)
              }
            >
              <ExternalLink />
            </Button>
          </>
        )}
        {dockControl}
      </div>
      <div
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"
        data-testid="reader-notes-body"
      >
        {noteId ? (
          <PanelNote
            key={noteId}
            noteId={noteId}
            autofocus={pickedId === noteId}
            onLoaded={setNote}
            onMissing={clearNote}
            onSavingChange={setSaving}
          />
        ) : (
          picker
        )}
      </div>
    </div>
  );
}
