"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ResolvedLinksMap, TiptapEditor } from "@episteme/editor";
import { NoteEditor } from "@/app/(app)/n/[slug]/NoteEditor";
import { Button } from "@/components/ui/button";
import { useTabs } from "@/components/TabBar";
import { useNoteFrontmatter } from "@/hooks/useNoteFrontmatter";
import { prepareNoteContent } from "@/lib/note-content";
import type { PickedNote } from "./NotePicker";

// The save an editor fires as it unmounts (dock change, note switch, panel
// close). The next load waits for it, so it never reads the text from before
// that save and then writes it back over the newer one.
let lastSave: Promise<void> = Promise.resolve();

type Loaded = { contentMd: string; resolvedLinks: ResolvedLinksMap };

/**
 * Loads one note and mounts the notes editor in the panel's compact layout.
 * Keyed by note id in the parent, so switching notes remounts it.
 */
export function PanelNote({
  noteId,
  autofocus,
  onLoaded,
  onMissing,
  onSavingChange,
}: {
  noteId: string;
  autofocus: boolean;
  onLoaded: (note: PickedNote) => void;
  /** The note is gone or in the trash. */
  onMissing: () => void;
  onSavingChange: (saving: boolean) => void;
}) {
  // null while loading.
  const [note, setNote] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void (async () => {
      try {
        await lastSave;
        const [noteRes, linksRes] = await Promise.all([
          fetch(`/api/notes/${noteId}`),
          fetch(`/api/notes/${noteId}/resolved-links`),
        ]);
        if (cancelled) return;
        if (noteRes.status === 404) return onMissing();
        if (!noteRes.ok || !linksRes.ok) return setFailed(true);
        const row = await noteRes.json();
        const resolvedLinks = await linksRes.json();
        if (cancelled) return;
        if (row.inTrash) return onMissing();
        onLoaded({ id: row.id, title: row.title, slug: row.slug });
        setNote({ contentMd: prepareNoteContent(row.contentMd ?? ""), resolvedLinks });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId, attempt, onLoaded, onMissing]);

  if (failed) {
    return (
      <div className="flex flex-col items-start gap-2 px-4 py-3 text-sm">
        <p className="text-destructive">Couldn&apos;t load this note.</p>
        <Button variant="outline" size="sm" onClick={() => setAttempt((a) => a + 1)}>
          Retry
        </Button>
      </div>
    );
  }
  if (!note) {
    return <div className="px-4 py-3 text-sm text-muted-foreground">Loading...</div>;
  }
  return (
    <LoadedNote
      noteId={noteId}
      note={note}
      autofocus={autofocus}
      onSavingChange={onSavingChange}
    />
  );
}

function LoadedNote({
  noteId,
  note,
  autofocus,
  onSavingChange,
}: {
  noteId: string;
  note: Loaded;
  autofocus: boolean;
  onSavingChange: (saving: boolean) => void;
}) {
  const { openInNewTab } = useTabs();
  const { body, transformMd } = useNoteFrontmatter(note.contentMd);
  const editorRef = useRef<TiptapEditor | null>(null);
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  // Layout cleanup runs before NoteEditor's own unmount flush, so this is the
  // call that sends the pending save and the promise covers it.
  useLayoutEffect(
    () => () => {
      lastSave = flushRef.current?.() ?? Promise.resolve();
    },
    [],
  );

  return (
    // The note page's `max-w-3xl p-6` wrapper and 60vh editor are sized for a
    // full page. Here the editor is as tall as its text, and a click on the
    // empty space below it still lands in the note.
    <div
      className="min-h-full px-4 py-3 [&_.episteme-prose]:min-h-0"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        editorRef.current?.commands.focus("end");
      }}
    >
      <NoteEditor
        id={noteId}
        initialMd={body}
        resolvedLinks={note.resolvedLinks}
        flushRef={flushRef}
        editorRef={editorRef}
        transformMd={transformMd}
        onPendingSaveChange={onSavingChange}
        onNavigate={openInNewTab}
        autofocus={autofocus}
      />
    </div>
  );
}
