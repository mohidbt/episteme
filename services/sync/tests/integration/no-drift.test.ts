// @vitest-environment jsdom
/**
 * Integration test (c): no content drift between yjs_state and content_md.
 *
 * After a store cycle, reads both columns and verifies that re-hydrating the
 * Y.Doc binary and serializing to markdown produces the exact same string as
 * the stored content_md.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { eq } from "drizzle-orm";
import { db } from "@episteme/db";
import { notes } from "@episteme/db/schema";
import { yjsToMd } from "../../src/yjs-to-md.js";
import {
  createTestUser,
  createTestLibrary,
  deleteTestUser,
  seedNote,
  startSyncServer,
  connectClient,
  waitFor,
  type TestUser,
  type SyncServer,
} from "./_helpers.js";

let userA: TestUser;
let libraryId: number;
let server: SyncServer;

beforeAll(async () => {
  userA = await createTestUser();
  libraryId = await createTestLibrary(userA.id);
  server = await startSyncServer({ port: 0 });
});

afterAll(async () => {
  await server.stop();
  await new Promise((r) => setTimeout(r, 300));
  await deleteTestUser(userA.id);
});

describe("no-drift — yjs_state round-trips to the same content_md", () => {
  it("re-hydrated Y.Doc serializes to the same markdown as stored content_md", async () => {
    const noteId = await seedNote(userA.id, libraryId, "");
    const client = connectClient({ noteId, port: server.port, cookie: userA.cookie });

    try {
      await client.awaitConnected;

      // Mutate
      const frag = client.ydoc.getXmlFragment("prosemirror");
      client.ydoc.transact(() => {
        const para = new Y.XmlElement("paragraph");
        const text = new Y.XmlText();
        text.insert(0, "no drift check");
        para.insert(0, [text]);
        frag.insert(0, [para]);
      });

      // Wait for persist
      await waitFor(
        async () => {
          const [row] = await db
            .select({ yjsState: notes.yjsState })
            .from(notes)
            .where(eq(notes.id, noteId));
          return !!(row?.yjsState && (row.yjsState as Uint8Array).length > 0);
        },
        { timeoutMs: 6_000, tickMs: 200 },
      );
    } finally {
      client.provider.destroy();
    }

    // Read both columns
    const [row] = await db
      .select({ yjsState: notes.yjsState, contentMd: notes.contentMd })
      .from(notes)
      .where(eq(notes.id, noteId));

    expect(row.yjsState).not.toBeNull();
    expect(row.contentMd).not.toBeNull();

    // Re-hydrate the Y.Doc from yjs_state and serialize to MD
    const freshDoc = new Y.Doc();
    Y.applyUpdate(freshDoc, row.yjsState as Uint8Array);
    const reserializedMd = yjsToMd(freshDoc);

    // The two strings must be byte-equal — no drift
    expect(reserializedMd).toBe(row.contentMd);
  });
});
