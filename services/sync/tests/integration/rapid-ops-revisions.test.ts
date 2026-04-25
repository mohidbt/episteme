// @vitest-environment jsdom
/**
 * Integration test (e): 100 rapid ops + revision threshold check.
 *
 * Threshold logic (from packages/notes-core/src/create-revision.ts):
 *   DELTA_MIN = 50 chars
 *   AGE_MIN_MS = 5 * 60 * 1000 ms (5 minutes)
 *   Skip revision only when: delta <= DELTA_MIN AND age <= AGE_MIN_MS
 *
 * Setup:
 *   - notes row seeded with contentMd = "hello" (5 chars)
 *   - 1 prior revision seeded 1 minute ago with contentMd = "hello"
 *   - 100 single-char inserts applied within ~1s
 *   - Hocuspocus debounce drains → onStoreDocument called once
 *
 * Expected final contentMd length after 100 single-char inserts:
 *   ProseMirror serializes a paragraph containing 100 "x"s → ~102 chars in MD.
 *   delta = |102 - 5| ≈ 97 > DELTA_MIN (50) → NEW revision IS created.
 *   age of prior revision ≈ 1 min < AGE_MIN_MS (5 min), but delta > 50 wins.
 *
 * Expected note_revisions count: 2 (seeded + exactly 1 new autosave snapshot).
 *
 * If the cumulative markdown delta turned out <= 50, the count would remain 1
 * (no new revision). The design here ensures delta > 50 by adding 100 chars.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { eq } from "drizzle-orm";
import { db } from "@episteme/db";
import { noteRevisions, notes } from "@episteme/db/schema";
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

describe("rapid ops — revision count stays bounded", () => {
  it("100 rapid single-char ops produce at most 2 revisions (seed + 1 threshold snapshot)", async () => {
    // Seed note with initial content
    const noteId = await seedNote(userA.id, libraryId, "hello");

    // Seed a prior revision dated 1 minute ago (mirrors persist.test.ts:212)
    await db.insert(noteRevisions).values({
      noteId,
      authorId: userA.id,
      contentMd: "hello",
      reason: "autosave",
      createdAt: new Date(Date.now() - 60 * 1_000),
    });

    const client = connectClient({ noteId, port: server.port, cookie: userA.cookie });
    try {
      await client.awaitConnected;

      // Apply 100 single-char inserts into the Y.Doc "prosemirror" XmlFragment.
      // Each is a separate transaction (maximally fragmented ops).
      // We insert a paragraph on first op, then append chars to its text node.
      const frag = client.ydoc.getXmlFragment("prosemirror");

      // Insert the initial paragraph structure
      let textNode: Y.XmlText;
      client.ydoc.transact(() => {
        const para = new Y.XmlElement("paragraph");
        textNode = new Y.XmlText();
        para.insert(0, [textNode!]);
        frag.insert(0, [para]);
      });

      // 100 individual single-char inserts — all within ~1 second
      for (let i = 0; i < 100; i++) {
        client.ydoc.transact(() => {
          textNode!.insert(textNode!.length, "x");
        });
      }

      // Wait for the Hocuspocus debounce to drain and persist to Postgres.
      // Hocuspocus default debounce is 2s; we wait up to 8s total.
      await waitFor(
        async () => {
          const [row] = await db
            .select({ contentMd: notes.contentMd })
            .from(notes)
            .where(eq(notes.id, noteId));
          // The stored content_md should contain the "xxx..." string we inserted
          return !!(row?.contentMd && row.contentMd.length > 50);
        },
        { timeoutMs: 8_000, tickMs: 300 },
      );
    } finally {
      client.provider.destroy();
    }

    // Read final state
    const [finalRow] = await db
      .select({ contentMd: notes.contentMd })
      .from(notes)
      .where(eq(notes.id, noteId));

    // delta = |finalMd.length - "hello".length|
    // ProseMirror serializes a paragraph with 100 "x"s → typically "xxxx...x\n"
    // so length >> 50, meaning a new revision was created.
    const delta = Math.abs((finalRow?.contentMd?.length ?? 0) - "hello".length);

    const revisions = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, noteId));

    // If delta > DELTA_MIN (50): 2 revisions (seed + 1 autosave snapshot)
    // If delta <= DELTA_MIN (50): 1 revision (seed only — threshold not crossed)
    // With 100 single-char inserts the final paragraph text is "xxx...x" (100 chars)
    // plus markdown paragraph wrapper → delta >> 50 → expect exactly 2.
    const expectedCount = delta > 50 ? 2 : 1;
    expect(revisions.length).toBe(expectedCount);

    // Regardless of delta, count must be <= 2 (no per-op revision explosion)
    expect(revisions.length).toBeLessThanOrEqual(2);
  });
});
