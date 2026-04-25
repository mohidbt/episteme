// @vitest-environment jsdom
/**
 * Integration test (d): reconnect with no content loss.
 *
 * clientA mutates to "alpha", disconnects, mutates locally to "alpha beta",
 * then reconnects. The server (and a fresh clientB) should end up with
 * "alpha beta" — no content lost.
 *
 * A concurrent offline edit from clientB is merged deterministically
 * (both edits survive after reconnect).
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
  // Stop server first (stops debounced writes), then delete user
  await server.stop();
  // Brief wait to let any in-flight Postgres queries complete
  await new Promise((r) => setTimeout(r, 200));
  await deleteTestUser(userA.id);
});

describe("reconnect — no content loss", () => {
  it(
    "offline mutations sync after reconnect; both client edits survive",
    async () => {
      const noteId = await seedNote(userA.id, libraryId, "");

      // ---- Connect clientA and make initial edit ----
      const clientA = connectClient({ noteId, port: server.port, cookie: userA.cookie });

      try {
        await clientA.awaitConnected;

        const fragA = clientA.ydoc.getXmlFragment("prosemirror");
        clientA.ydoc.transact(() => {
          const para = new Y.XmlElement("paragraph");
          const text = new Y.XmlText();
          text.insert(0, "alpha");
          para.insert(0, [text]);
          fragA.insert(0, [para]);
        });

        // Wait for "alpha" to be stored in Postgres
        await waitFor(
          async () => {
            const [row] = await db
              .select({ contentMd: notes.contentMd })
              .from(notes)
              .where(eq(notes.id, noteId));
            return !!(row?.contentMd?.includes("alpha"));
          },
          { timeoutMs: 8_000, tickMs: 200 },
        );

        // ---- Disconnect clientA ----
        clientA.provider.disconnect();
        await new Promise((r) => setTimeout(r, 150));

        // ---- Offline mutation on clientA while disconnected ----
        clientA.ydoc.transact(() => {
          const para = new Y.XmlElement("paragraph");
          const text = new Y.XmlText();
          text.insert(0, "beta");
          para.insert(0, [text]);
          fragA.insert(fragA.length, [para]);
        });

        // ---- Connect clientB (online) ----
        const clientB = connectClient({ noteId, port: server.port, cookie: userA.cookie });
        try {
          await clientB.awaitConnected;

          // clientB makes its own offline edit
          const fragB = clientB.ydoc.getXmlFragment("prosemirror");
          clientB.provider.disconnect();
          await new Promise((r) => setTimeout(r, 100));

          clientB.ydoc.transact(() => {
            const para = new Y.XmlElement("paragraph");
            const text = new Y.XmlText();
            text.insert(0, "gamma");
            para.insert(0, [text]);
            fragB.insert(fragB.length, [para]);
          });

          // ---- Reconnect both ----
          clientB.provider.connect();
          clientA.provider.connect();

          // Poll until both docs have converged with all three edits.
          // We use waitFor on the fragment JSON rather than listening for 'synced'
          // (synced may fire before CRDT merge completes across both clients).
          await waitFor(
            () => {
              const aJson = fragA.toJSON();
              const bJson = fragB.toJSON();
              return (
                aJson.includes("alpha") &&
                aJson.includes("beta") &&
                aJson.includes("gamma") &&
                bJson.includes("alpha") &&
                bJson.includes("beta") &&
                bJson.includes("gamma")
              );
            },
            { timeoutMs: 8_000, tickMs: 100 },
          );

          // All three edits survive — no content loss
          expect(fragA.toJSON()).toContain("alpha");
          expect(fragA.toJSON()).toContain("beta");
          expect(fragA.toJSON()).toContain("gamma");
          expect(fragB.toJSON()).toContain("alpha");
          expect(fragB.toJSON()).toContain("beta");
          expect(fragB.toJSON()).toContain("gamma");
        } finally {
          clientB.provider.destroy();
        }
      } finally {
        clientA.provider.destroy();
      }
    },
    20_000, // extended timeout for reconnect + CRDT merge
  );
});
