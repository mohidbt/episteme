"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { invalidateDriveTree } from "@/lib/drive-sync";
import { maybeShowGuestError } from "@/lib/guest-error";

export type PickedNote = { id: string; title: string; slug: string };

/**
 * The reader notes panel's note chooser: "New note" first, then the user's
 * notes, last edited first, filtered by the search input. Rendered inside the
 * header popover and inline as the panel's empty state.
 */
export function NotePicker({
  paperTitle,
  libraryId,
  folderId,
  onPick,
}: {
  /** Title given to a new note. */
  paperTitle: string;
  libraryId: number;
  /** Folder a new note is created in: the paper's, so they sit together. */
  folderId: string | null;
  onPick: (note: PickedNote) => void;
}) {
  const [query, setQuery] = useState("");
  // null while loading.
  const [notes, setNotes] = useState<PickedNote[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    setFailed(false);
    const params = new URLSearchParams({ sort: "recent", k: "50", q: query.trim() });
    fetch(`/api/notes/search?${params}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http ${r.status}`))))
      .then((data: { results: PickedNote[] }) => setNotes(data.results))
      .catch(() => {
        if (!ctl.signal.aborted) setFailed(true);
      });
    return () => ctl.abort();
  }, [query, attempt]);

  async function createNote() {
    setCreating(true);
    const r = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ libraryId, folderId, title: paperTitle }),
    });
    setCreating(false);
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      if (maybeShowGuestError(r, body)) return;
      toast.error("Create failed");
      return;
    }
    const note = (await r.json()) as PickedNote;
    invalidateDriveTree();
    onPick({ id: note.id, title: note.title, slug: note.slug });
  }

  return (
    <Command shouldFilter={false} data-testid="note-picker">
      <CommandInput placeholder="Search notes..." value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandGroup>
          <CommandItem value="new-note" disabled={creating} onSelect={() => void createNote()}>
            <Plus aria-hidden />
            New note
          </CommandItem>
        </CommandGroup>
        {failed ? (
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-destructive">
            Couldn&apos;t load notes.
            <Button variant="outline" size="sm" onClick={() => setAttempt((a) => a + 1)}>
              Retry
            </Button>
          </div>
        ) : notes === null ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
        ) : notes.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">No notes found.</div>
        ) : (
          <CommandGroup heading="Recent notes">
            {notes.map((note) => (
              <CommandItem key={note.id} value={note.id} onSelect={() => onPick(note)}>
                <span className="truncate">{note.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}
