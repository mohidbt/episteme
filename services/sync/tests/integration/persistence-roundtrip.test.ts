// @vitest-environment jsdom
/**
 * Integration test (b): persistence round-trip.
 *
 * Server #1: clientA connects, mutates, server stores to Postgres.
 * Verify notes.yjs_state is non-null and notes.content_md has the mutation.
 * Server #2: fresh Hocuspocus, clientB connects, onLoadDocument applies stored
 * yjs_state — clientB's Y.Doc should reflect clientA's mutation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { eq } from "drizzle-orm";
import { db } from "@episteme/db";
import { notes } from "@episteme/db/schema";
import {
  createTestUser,
  createTestLibrary,
  deleteTestUser,
  seedNote,
  startSyncServer,
  connectClient,
  waitFor,
  type TestUser,
} from "./_helpers.js";

let userA: TestUser;
let libraryId: number;

beforeAll(async () => {
  userA = await createTestUser();
  libraryId = await createTestLibrary(userA.id);
});

afterAll(async () => {
  await deleteTestUser(userA.id);
});

describe("persistence round-trip", () => {
  it("stores yjs_state and content_md, then a fresh server loads them back", async () => {
    const noteId = await seedNote(userA.id, libraryId, "");

    // ---- Server #1 ----
    const server1 = await startSyncServer({ port: 0 });
    let clientA = connectClient({ noteId, port: server1.port, cookie: userA.cookie });

    try {
      await clientA.awaitConnected;

      // Mutate
      const frag = clientA.ydoc.getXmlFragment("prosemirror");
      clientA.ydoc.transact(() => {
        const para = new Y.XmlElement("paragraph");
        const text = new Y.XmlText();
        text.insert(0, "round-trip content");
        para.insert(0, [text]);
        frag.insert(0, [para]);
      });

      // Wait for the server to persist (Hocuspocus debounce default is 2s;
      // we poll Postgres until yjs_state appears, up to 5s).
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
      clientA.provider.destroy();
      await server1.stop();
    }

    // ---- Verify DB state ----
    const [storedRow] = await db
      .select({ yjsState: notes.yjsState, contentMd: notes.contentMd })
      .from(notes)
      .where(eq(notes.id, noteId));

    expect(storedRow.yjsState).not.toBeNull();
    expect((storedRow.yjsState as Uint8Array).length).toBeGreaterThan(0);
    expect(storedRow.contentMd).toContain("round-trip content");

    // ---- Server #2 ----
    const server2 = await startSyncServer({ port: 0 });
    const clientB = connectClient({ noteId, port: server2.port, cookie: userA.cookie });

    try {
      await clientB.awaitConnected;

      // onLoadDocument should have applied the stored yjs_state
      const fragB = clientB.ydoc.getXmlFragment("prosemirror");
      await waitFor(
        () => fragB.toJSON().includes("round-trip content"),
        { timeoutMs: 2_000 },
      );

      expect(fragB.toJSON()).toContain("round-trip content");

      // Verify the bytes from Postgres applied correctly by comparing
      // the stored state against what clientB has
      const storedDoc = new Y.Doc();
      Y.applyUpdate(storedDoc, storedRow.yjsState as Uint8Array);
      expect(storedDoc.getXmlFragment("prosemirror").toJSON()).toBe(
        fragB.toJSON(),
      );
    } finally {
      clientB.provider.destroy();
      await server2.stop();
    }
  });
});
