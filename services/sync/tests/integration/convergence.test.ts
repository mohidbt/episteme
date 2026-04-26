// @vitest-environment jsdom
/**
 * Integration test (a): two-client convergence over a real Hocuspocus server.
 *
 * Client A mutates → client B converges, and vice-versa.
 * Uses real Postgres-seeded Better Auth sessions and a real WebSocket server.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
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
  // Stop server first to drain any pending debounced writes before deleting rows.
  await server.stop();
  // Brief settle so in-flight Postgres queries complete before FK-cascaded deletes.
  await new Promise((r) => setTimeout(r, 300));
  await deleteTestUser(userA.id);
});

describe("convergence — two clients, same note", () => {
  it("clientA mutation propagates to clientB", async () => {
    const noteId = await seedNote(userA.id, libraryId, "");

    const clientA = connectClient({ noteId, port: server.port, cookie: userA.cookie });
    const clientB = connectClient({ noteId, port: server.port, cookie: userA.cookie });

    try {
      await Promise.all([clientA.awaitConnected, clientB.awaitConnected]);

      // Mutate clientA's Y.Doc directly on the "prosemirror" XmlFragment
      const fragA = clientA.ydoc.getXmlFragment("prosemirror");
      clientA.ydoc.transact(() => {
        const para = new Y.XmlElement("paragraph");
        const text = new Y.XmlText();
        text.insert(0, "hello from A");
        para.insert(0, [text]);
        fragA.insert(0, [para]);
      });

      // Poll clientB for convergence
      const fragB = clientB.ydoc.getXmlFragment("prosemirror");
      await waitFor(
        () => fragB.toJSON().includes("hello from A"),
        { timeoutMs: 1_000 },
      );

      expect(fragB.toJSON()).toContain("hello from A");
    } finally {
      clientA.provider.destroy();
      clientB.provider.destroy();
    }
  });

  it("clientB mutation propagates to clientA (reverse)", async () => {
    const noteId = await seedNote(userA.id, libraryId, "");

    const clientA = connectClient({ noteId, port: server.port, cookie: userA.cookie });
    const clientB = connectClient({ noteId, port: server.port, cookie: userA.cookie });

    try {
      await Promise.all([clientA.awaitConnected, clientB.awaitConnected]);

      const fragB = clientB.ydoc.getXmlFragment("prosemirror");
      clientB.ydoc.transact(() => {
        const para = new Y.XmlElement("paragraph");
        const text = new Y.XmlText();
        text.insert(0, "hello from B");
        para.insert(0, [text]);
        fragB.insert(0, [para]);
      });

      const fragA = clientA.ydoc.getXmlFragment("prosemirror");
      await waitFor(
        () => fragA.toJSON().includes("hello from B"),
        { timeoutMs: 1_000 },
      );

      expect(fragA.toJSON()).toContain("hello from B");
    } finally {
      clientA.provider.destroy();
      clientB.provider.destroy();
    }
  });
});
