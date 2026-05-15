import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { mdToProseMirror, type JSONContent } from "@episteme/markdown";
import { rebuildLinks } from "@episteme/notes-core";
import { createRevisionIfNeeded, type RevisionReason } from "@episteme/notes-core";
import { embedOnSave } from "@/lib/ai/embed-on-save";
import {
  LIBRARY_BYTES_LIMIT,
  getLibraryUsageBytes,
} from "@/lib/library-usage";

export class NoteOverLimitError extends Error {
  readonly usedBytes: number;
  readonly limitBytes: number;
  constructor(usedBytes: number, limitBytes: number) {
    super("over_limit");
    this.name = "NoteOverLimitError";
    this.usedBytes = usedBytes;
    this.limitBytes = limitBytes;
  }
}

// TODO(phase-0.2 follow-up): Tiptap's `new Editor(...)` requires a DOM (reads
// `document` at construction), and Next.js Node route handlers have no DOM.
// Attempting to precompute `contentJson` server-side throws
// "ReferenceError: document is not defined" and breaks autosave. For now we
// persist `contentMd` only and write `null` to `contentJson` — the client
// editor is the source of truth for the ProseMirror doc and can recompute it
// from `contentMd` on load. Revisit with either:
//   - a lightweight markdown→PM JSON converter that doesn't instantiate Tiptap
//   - jsdom/linkedom shim on the server for Tiptap (bundle cost)
//   - move the JSON computation into a separate worker/edge runtime
export async function saveNoteMd(
  id: string,
  contentMd: string,
  userId: string,
  reason: RevisionReason = "autosave",
): Promise<void> {
  let contentJson: JSONContent | null = null;
  try {
    contentJson = mdToProseMirror(contentMd);
  } catch (err) {
    // Tiptap fails in Node (no DOM) — degrade to MD-only persistence.
    console.warn(
      "[saveNoteMd] mdToProseMirror failed; persisting contentMd only",
      err instanceof Error ? err.message : err,
    );
    contentJson = null;
  }
  // Compute revision delta against the OLD notes.contentMd — must run BEFORE
  // the update below, otherwise the delta gate always sees delta=0 and only
  // the age gate (>5min) can trigger an autosave revision.
  await createRevisionIfNeeded({ noteId: id, authorId: userId, newMd: contentMd, reason });
  // Keep size_bytes in sync with content_md so the per-library cap reflects
  // edits, not just the initial create. Byte length matches the migration
  // backfill rule (octet_length).
  const sizeBytes = Buffer.byteLength(contentMd, "utf8");

  // Cap check on edits (Codex Round B follow-up): an edit can grow a note
  // past 100 MB even if the create path was gated. Read the prior row size
  // + library, recompute usage minus the old contribution, then test the
  // new size. Throw NoteOverLimitError so callers map to HTTP 413.
  const [existing] = await db
    .select({ libraryId: notes.libraryId, sizeBytes: notes.sizeBytes })
    .from(notes)
    .where(eq(notes.id, id))
    .limit(1);
  if (existing) {
    const usage = await getLibraryUsageBytes(existing.libraryId);
    const projected =
      usage.total - Number(existing.sizeBytes ?? 0) + sizeBytes;
    if (projected > LIBRARY_BYTES_LIMIT) {
      throw new NoteOverLimitError(usage.total, LIBRARY_BYTES_LIMIT);
    }
  }

  await db
    .update(notes)
    .set({ contentMd, contentJson, sizeBytes, updatedAt: new Date() })
    .where(eq(notes.id, id));
  await rebuildLinks(id, contentMd, userId);
  try {
    void embedOnSave(id, contentMd, userId).catch((err) => {
      console.warn("[saveNoteMd] embed dispatch", err);
    });
  } catch (err) {
    console.warn("[saveNoteMd] embed dispatch sync", err);
  }
}
