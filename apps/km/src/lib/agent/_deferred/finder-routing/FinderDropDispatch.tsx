"use client";

// GSD-96 R4 — Finder drop dispatcher + chip lifecycle.
//
// Splits Finder-drop handling off from the legacy GSD-27/41 asset uploader.
// For images we delegate back to the existing `useChatAttachments.addFiles`
// path; for everything else we run the per-action API call here and surface
// either a library-handle chip (paper/note/reference) or a red rejection chip.
//
// Chip lifecycle states (plan §3.8):
//   uploading  → init + PUT (paper) or POST (note/bib/ris)
//   ingesting  → finalize fired, awaiting first poll (paper only)
//   analyzing  → polling /ingest-status, chunks_ready_at IS NULL (paper only)
//   ready      → success; chip carries a LibraryHandle
//   error      → upload or ingest failure
//   rejected   → unsupported MIME / ext (no API call fired)
//
// Send button is gated by `someNotReady(chips)` — caller plumbs it.

import { useCallback, useRef, useState, useEffect } from "react";
import { routeFinderDrop } from "@/lib/agent/finder-routing";
import type { LibraryHandle, LibraryKind } from "@/lib/agent/lib-tokens";

export type FinderChipStatus =
  | "uploading"
  | "ingesting"
  | "analyzing"
  | "ready"
  | "error"
  | "rejected";

export interface FinderChip {
  id: string;
  filename: string;
  status: FinderChipStatus;
  // Populated once ready. Multiple handles for .bib/.ris (one chip per file
  // is the user-visible artifact; the handles array fans out into N library
  // tokens on send).
  handles: LibraryHandle[];
  errorMsg?: string;
}

export interface UseFinderDropDispatchResult {
  chips: FinderChip[];
  /** Caller plumbs files from onDrop into this dispatcher. */
  dispatch: (files: FileList | File[]) => void;
  removeChip: (id: string) => void;
  clearChips: () => void;
  /** True while ANY chip is non-ready (drives Send button gate). */
  someNotReady: boolean;
  /** Snapshot of every ready handle (for token assembly on send). */
  readyHandles: LibraryHandle[];
}

interface LibraryRow {
  id: number;
}

async function resolveLibraryId(): Promise<number | null> {
  const r = await fetch("/api/libraries", {
    credentials: "include",
    cache: "no-store",
  });
  if (!r.ok) return null;
  const libs = (await r.json()) as LibraryRow[];
  return typeof libs[0]?.id === "number" ? libs[0].id : null;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000;

function randId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useFinderDropDispatch(
  /** Forward images to the legacy asset uploader for chip display. */
  forwardAsset: (file: File) => void,
): UseFinderDropDispatchResult {
  const [chips, setChips] = useState<FinderChip[]>([]);
  // Track active poll timers so we can stop polling on unmount / remove.
  const pollersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const stopPoll = useCallback((chipId: string) => {
    const t = pollersRef.current.get(chipId);
    if (t) {
      clearInterval(t);
      pollersRef.current.delete(chipId);
    }
  }, []);

  useEffect(() => {
    const map = pollersRef.current;
    return () => {
      map.forEach((t) => clearInterval(t));
      map.clear();
    };
  }, []);

  const patchChip = useCallback((id: string, patch: Partial<FinderChip>) => {
    setChips((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const ingestPaper = useCallback(
    async (chipId: string, file: File, libraryId: number) => {
      // POST /api/papers → { paperId, uploadUrl }
      const initRes = await fetch("/api/papers", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          libraryId,
          folderPath: "",
          filename: file.name,
          contentType: "application/pdf",
          sizeBytes: file.size,
        }),
      });
      if (!initRes.ok) throw new Error(`paper_init_${initRes.status}`);
      const { paperId, uploadUrl } = (await initRes.json()) as {
        paperId: string;
        uploadUrl: string;
      };

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": "application/pdf" },
        body: file,
      });
      if (!putRes.ok) throw new Error(`paper_put_${putRes.status}`);

      patchChip(chipId, { status: "ingesting" });

      const finRes = await fetch(`/api/papers/${paperId}/finalize`, {
        method: "POST",
        credentials: "include",
      });
      if (!finRes.ok) throw new Error(`paper_finalize_${finRes.status}`);
      const fin = (await finRes.json()) as { id: string; title?: string };
      const title = fin.title ?? file.name.replace(/\.pdf$/i, "");

      patchChip(chipId, { status: "analyzing" });

      // Poll ingest-status every POLL_INTERVAL_MS until chunks_ready_at OR
      // POLL_TIMEOUT_MS elapses (then transition to error chip).
      const startedAt = Date.now();
      const timer = setInterval(() => {
        void (async () => {
          try {
            const r = await fetch(`/api/papers/${paperId}/ingest-status`, {
              credentials: "include",
            });
            if (!r.ok) return; // transient — keep polling until timeout
            const body = (await r.json()) as { chunksReadyAt: string | null };
            if (body.chunksReadyAt) {
              stopPoll(chipId);
              patchChip(chipId, {
                status: "ready",
                handles: [{ kind: "paper", id: paperId, title }],
              });
              return;
            }
            if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
              stopPoll(chipId);
              patchChip(chipId, {
                status: "error",
                errorMsg: "Ingest timed out",
              });
            }
          } catch {
            // ignore transient — timeout branch handles death
          }
        })();
      }, POLL_INTERVAL_MS);
      pollersRef.current.set(chipId, timer);
    },
    [patchChip, stopPoll],
  );

  const ingestNote = useCallback(
    async (chipId: string, file: File, libraryId: number) => {
      const fd = new FormData();
      fd.append("libraryId", String(libraryId));
      fd.append("file", file);
      const r = await fetch("/api/notes/from-file", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!r.ok) throw new Error(`note_${r.status}`);
      const body = (await r.json()) as { id: string; title: string };
      patchChip(chipId, {
        status: "ready",
        handles: [{ kind: "note", id: body.id, title: body.title }],
      });
    },
    [patchChip],
  );

  const ingestReferences = useCallback(
    async (
      chipId: string,
      file: File,
      libraryId: number,
      mode: "bib" | "ris",
    ) => {
      const fd = new FormData();
      fd.append("libraryId", String(libraryId));
      fd.append("file", file);
      const url =
        mode === "bib" ? "/api/references/from-bib" : "/api/references/import";
      const r = await fetch(url, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!r.ok) throw new Error(`refs_${mode}_${r.status}`);
      const body = (await r.json()) as {
        references?: Array<{ id: string; title: string }>;
      };
      const refs = body.references ?? [];
      const handles: LibraryHandle[] = refs.map((rf) => ({
        kind: "reference" as LibraryKind,
        id: rf.id,
        title: rf.title,
      }));
      patchChip(chipId, { status: "ready", handles });
    },
    [patchChip],
  );

  const dispatchOne = useCallback(
    async (file: File) => {
      const action = routeFinderDrop(file);
      if (action.kind === "asset") {
        forwardAsset(file);
        return;
      }
      if (action.kind === "reject") {
        setChips((cur) => [
          ...cur,
          {
            id: randId(),
            filename: file.name || "(unnamed)",
            status: "rejected",
            handles: [],
            errorMsg: action.reason ?? "We cannot process this file",
          },
        ]);
        return;
      }

      const chipId = randId();
      setChips((cur) => [
        ...cur,
        {
          id: chipId,
          filename: file.name,
          status: "uploading",
          handles: [],
        },
      ]);

      try {
        const libraryId = await resolveLibraryId();
        if (libraryId === null) {
          patchChip(chipId, { status: "error", errorMsg: "no library" });
          return;
        }
        if (action.kind === "paper") {
          await ingestPaper(chipId, file, libraryId);
        } else if (action.kind === "note") {
          await ingestNote(chipId, file, libraryId);
        } else if (action.kind === "reference-bib") {
          await ingestReferences(chipId, file, libraryId, "bib");
        } else if (action.kind === "reference-ris") {
          await ingestReferences(chipId, file, libraryId, "ris");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "upload_failed";
        patchChip(chipId, { status: "error", errorMsg: msg });
      }
    },
    [forwardAsset, patchChip, ingestPaper, ingestNote, ingestReferences],
  );

  const dispatch = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      for (const f of arr) void dispatchOne(f);
    },
    [dispatchOne],
  );

  const removeChip = useCallback(
    (id: string) => {
      stopPoll(id);
      setChips((cur) => cur.filter((c) => c.id !== id));
    },
    [stopPoll],
  );

  const clearChips = useCallback(() => {
    pollersRef.current.forEach((t) => clearInterval(t));
    pollersRef.current.clear();
    setChips([]);
  }, []);

  const someNotReady = chips.some(
    (c) => c.status !== "ready" && c.status !== "rejected" && c.status !== "error",
  );
  const readyHandles: LibraryHandle[] = [];
  for (const c of chips) {
    if (c.status === "ready") readyHandles.push(...c.handles);
  }

  return { chips, dispatch, removeChip, clearChips, someNotReady, readyHandles };
}

export interface FinderChipsProps {
  chips: FinderChip[];
  onRemove: (id: string) => void;
}

function chipLabel(c: FinderChip): string {
  switch (c.status) {
    case "uploading":
      return "Uploading…";
    case "ingesting":
      return "Ingesting…";
    case "analyzing":
      return "Analyzing…";
    case "ready":
      return "Ready";
    case "error":
      return c.errorMsg ?? "Error";
    case "rejected":
      return c.errorMsg ?? "We cannot process this file";
  }
}

export function FinderChips({ chips, onRemove }: FinderChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div
      className="flex flex-wrap gap-1.5 px-2 pt-2"
      data-testid="finder-chips"
    >
      {chips.map((c) => {
        const isError = c.status === "error" || c.status === "rejected";
        return (
          <span
            key={c.id}
            data-testid={`finder-chip-${c.status}`}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${
              isError
                ? "border border-destructive/40 bg-destructive/10 text-destructive"
                : "border bg-muted/40"
            }`}
          >
            <span className="truncate max-w-[160px]" title={c.filename}>
              {c.filename}
            </span>
            <span className="text-muted-foreground">{chipLabel(c)}</span>
            <button
              type="button"
              aria-label={`Remove ${c.filename}`}
              onClick={() => onRemove(c.id)}
              className="ml-1 text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}
