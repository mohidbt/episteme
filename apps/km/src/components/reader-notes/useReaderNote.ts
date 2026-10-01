"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Entry = { noteId: string | null; open: boolean };

const EMPTY: Entry = { noteId: null, open: false };

const storageKey = (paperId: string) => `reader-notes:v1:${paperId}`;

function read(paperId: string): Entry {
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey(paperId)) ?? "null");
    return {
      noteId: typeof stored?.noteId === "string" ? stored.noteId : null,
      open: stored?.open === true,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Which note the reader's notes panel shows for a paper, and whether the panel
 * is open. Remembered per paper in this browser; with storage unavailable the
 * state still holds for the current visit.
 */
export function useReaderNote(paperId: string) {
  const [entry, setEntry] = useState(EMPTY);
  const entryRef = useRef(entry);

  // Read after mount (like useSidebarDock) so server and first client render agree.
  useEffect(() => {
    entryRef.current = read(paperId);
    setEntry(entryRef.current);
  }, [paperId]);

  const update = useCallback(
    (patch: Partial<Entry>) => {
      entryRef.current = { ...entryRef.current, ...patch };
      setEntry(entryRef.current);
      try {
        window.localStorage.setItem(storageKey(paperId), JSON.stringify(entryRef.current));
      } catch {
        // Storage unavailable: keep the in-memory state for this visit.
      }
    },
    [paperId],
  );

  const setNoteId = useCallback((noteId: string | null) => update({ noteId }), [update]);
  const setOpen = useCallback((open: boolean) => update({ open }), [update]);

  return { noteId: entry.noteId, open: entry.open, setNoteId, setOpen };
}
