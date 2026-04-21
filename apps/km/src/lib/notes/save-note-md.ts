import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { mdToProseMirror, type JSONContent } from "@episteme/markdown";
import { rebuildLinks } from "./rebuild-links";

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
  await db
    .update(notes)
    .set({ contentMd, contentJson, updatedAt: new Date() })
    .where(eq(notes.id, id));
  await rebuildLinks(id, contentMd, userId);
  // TODO(phase-0.6): create note_revisions row per PRD §4.6 triggers
}
