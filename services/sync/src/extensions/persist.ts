import type { Extension, onLoadDocumentPayload, onStoreDocumentPayload } from "@hocuspocus/server";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import { Editor } from "@tiptap/core";
import { eq } from "drizzle-orm";
import { db } from "@episteme/db";
import { notes, type ProseMirrorJSON } from "@episteme/db/schema";
import { mdToProseMirror, createExtensions } from "@episteme/markdown";
import { rebuildLinks, createRevisionIfNeeded } from "@episteme/notes-core";
import { yDocToPmJson, pmJsonToMd } from "../yjs-to-md.js";
import { parseNoteDocumentName } from "./document-name.js";

/**
 * Get a ProseMirror schema from a temporary Tiptap Editor instance.
 * NOTE: Requires a DOM environment (jsdom in tests; add jsdom/linkedom to server for production).
 */
function getProseMirrorSchema() {
  const editor = new Editor({ extensions: createExtensions() });
  const schema = editor.schema;
  editor.destroy();
  return schema;
}

export function persistExt(): Pick<Extension, "onStoreDocument" | "onLoadDocument"> {
  return {
    async onStoreDocument({ document, documentName, context }: onStoreDocumentPayload) {
      const noteId = parseNoteDocumentName(documentName);
      if (!noteId) return; // non-note document, ignore

      const userId: string | undefined = (context as { user?: { id?: string } }).user?.id;
      if (!userId) {
        throw new Error(
          `persist: no user on context for ${documentName} — authenticate extension should have rejected this`,
        );
      }

      // 1. Serialize Y.Doc → binary update + ProseMirror JSON + markdown.
      // Keep pmJson around so we can write it to contentJson and avoid drift
      // with the REST save path (apps/km/.../save-note-md.ts).
      const yjsState = Y.encodeStateAsUpdate(document);
      const pmJson = yDocToPmJson(document);
      const contentMd = pmJsonToMd(pmJson);

      // 2. Side effects — run BEFORE updating contentMd so createRevisionIfNeeded
      // can compute the delta against the OLD notes.contentMd.
      // Eventual-consistency trade-off: if the process dies between step 2 and
      // step 3, note_links / note_revisions may lag by one save cycle.
      // Revisit with a single transaction if a race condition is observed (Phase 1.0 choice (b)).
      await createRevisionIfNeeded({
        noteId,
        authorId: userId,
        newMd: contentMd,
        reason: "autosave",
      });
      await rebuildLinks(noteId, contentMd, userId);

      // 3. Persist yjs_state + content_md + content_json to the notes row.
      await db
        .update(notes)
        .set({
          yjsState,
          contentMd,
          contentJson: pmJson as ProseMirrorJSON,
          updatedAt: new Date(),
        })
        .where(eq(notes.id, noteId));
    },

    async onLoadDocument({ document, documentName }: onLoadDocumentPayload) {
      const noteId = parseNoteDocumentName(documentName);
      if (!noteId) return;

      const [row] = await db
        .select({ yjsState: notes.yjsState, contentMd: notes.contentMd })
        .from(notes)
        .where(eq(notes.id, noteId));

      if (!row) return;

      if (row.yjsState && row.yjsState.length > 0) {
        // Y state is the convergence cache — apply it and ignore content_md.
        Y.applyUpdate(document, row.yjsState);
      } else if (row.contentMd) {
        // Bootstrap from markdown on first collaborative load.
        // NOTE: Requires a DOM environment (jsdom in tests, jsdom/linkedom in server).
        try {
          const pmJson = mdToProseMirror(row.contentMd);
          const schema = getProseMirrorSchema();
          const seedDoc = prosemirrorJSONToYDoc(schema, pmJson);
          const update = Y.encodeStateAsUpdate(seedDoc);
          Y.applyUpdate(document, update);
        } catch (err) {
          console.warn("[persist.onLoadDocument] markdown bootstrap failed, leaving doc empty:", err);
        }
      }
    },
  };
}
