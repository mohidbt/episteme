// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import { eq } from "drizzle-orm";
import { db } from "@episteme/db";
import { libraries, noteLinks, noteRevisions, notes, user } from "@episteme/db/schema";
import { auth } from "@episteme/auth";
import { persistExt } from "../src/extensions/persist.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTag() {
  return `p_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

interface TestUser {
  id: string;
  cookie: string;
}

async function createTestUser(): Promise<TestUser> {
  const tag = makeTag();
  const email = `${tag}@persist-test.local`;
  const password = "test-password-1234";
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password, name: "Persist Test User" },
    returnHeaders: true,
  });
  const setCookie = headers.get("set-cookie");
  if (!setCookie) throw new Error("signUpEmail returned no set-cookie header");
  const cookie = setCookie.split(";")[0];
  const id = (response as { user: { id: string } }).user.id;
  return { id, cookie };
}

async function deleteTestUser(id: string): Promise<void> {
  await db.delete(user).where(eq(user.id, id));
}

/** Build a Y.Doc seeded from markdown via mdToProseMirror + prosemirrorJSONToYDoc. */
function mdToYDoc(md: string): Y.Doc {
  const { Editor } = require("@tiptap/core");
  const { createExtensions, mdToProseMirror } = require("@episteme/markdown");
  const pmJson = mdToProseMirror(md);
  const editor = new Editor({ extensions: createExtensions() });
  const schema = editor.schema;
  editor.destroy();
  return prosemirrorJSONToYDoc(schema, pmJson);
}

/** Minimal onStoreDocument-like payload factory. */
function storePayload(overrides: {
  documentName: string;
  document: Y.Doc;
  context?: Record<string, unknown>;
}) {
  return {
    documentName: overrides.documentName,
    document: overrides.document,
    context: overrides.context ?? {},
    clientsCount: 1,
    instance: {} as never,
    requestHeaders: {},
    requestParameters: new URLSearchParams(),
    socketId: "test-socket",
    transactionOrigin: undefined,
  };
}

/** Minimal onLoadDocument-like payload factory. */
function loadPayload(overrides: {
  documentName: string;
  document?: Y.Doc;
}) {
  return {
    documentName: overrides.documentName,
    document: overrides.document ?? new Y.Doc(),
    context: {},
    instance: {} as never,
    requestHeaders: {},
    requestParameters: new URLSearchParams(),
    socketId: "test-socket",
    connection: { readOnly: false, requiresAuthentication: true, isAuthenticated: true },
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let u: TestUser;
let libraryId: number;

beforeAll(async () => {
  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Persist Test Lib" })
    .returning();
  libraryId = lib.id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

async function makeNote(contentMd = ""): Promise<string> {
  const [row] = await db
    .insert(notes)
    .values({
      userId: u.id,
      libraryId,
      title: "Persist Test Note",
      slug: `persist-test-${makeTag()}`,
      contentMd,
    })
    .returning({ id: notes.id });
  return row.id;
}

const ext = persistExt();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("persistExt — onStoreDocument", () => {
  it("writes yjs_state (bytea) and content_md to the notes row", async () => {
    const noteId = await makeNote("initial content");
    const doc = mdToYDoc("## Hello\n\nWorld paragraph.");
    await ext.onStoreDocument!(
      storePayload({ documentName: `note:${noteId}`, document: doc }),
    );

    const [row] = await db
      .select({ yjsState: notes.yjsState, contentMd: notes.contentMd })
      .from(notes)
      .where(eq(notes.id, noteId));

    expect(row.yjsState).not.toBeNull();
    expect(row.yjsState).toBeInstanceOf(Uint8Array);
    expect((row.yjsState as Uint8Array).length).toBeGreaterThan(0);
    expect(row.contentMd).toContain("Hello");
  });

  it("bumps updated_at on store", async () => {
    const noteId = await makeNote("initial");
    const [before] = await db
      .select({ updatedAt: notes.updatedAt })
      .from(notes)
      .where(eq(notes.id, noteId));

    // Small sleep so timestamps differ
    await new Promise((r) => setTimeout(r, 10));

    const doc = mdToYDoc("updated content");
    await ext.onStoreDocument!(
      storePayload({ documentName: `note:${noteId}`, document: doc }),
    );

    const [after] = await db
      .select({ updatedAt: notes.updatedAt })
      .from(notes)
      .where(eq(notes.id, noteId));

    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });

  it("records outgoing [[WikiLink]] targets into note_links", async () => {
    // Create a target note to resolve against
    const [targetRow] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId,
        title: "WikiTarget",
        slug: `wiki-target-${makeTag()}`,
        contentMd: "",
      })
      .returning({ id: notes.id });

    const noteId = await makeNote("");
    const doc = mdToYDoc("See [[WikiTarget]] here.");

    await ext.onStoreDocument!(
      storePayload({
        documentName: `note:${noteId}`,
        document: doc,
        context: { user: { id: u.id } },
      }),
    );

    const links = await db
      .select()
      .from(noteLinks)
      .where(eq(noteLinks.sourceNoteId, noteId));

    expect(links.length).toBeGreaterThan(0);
    const wikiLink = links.find((l) => l.targetTitleRaw === "WikiTarget");
    expect(wikiLink).toBeDefined();
    expect(wikiLink!.targetId).toBe(targetRow.id);

    // Cleanup
    await db.delete(notes).where(eq(notes.id, targetRow.id));
  });

  it("calls createRevisionIfNeeded — small edits below threshold do NOT add revisions", async () => {
    const noteId = await makeNote("hello");

    // Seed an existing revision within 5 min
    await db.insert(noteRevisions).values({
      noteId,
      authorId: u.id,
      contentMd: "hello",
      reason: "autosave",
      createdAt: new Date(Date.now() - 60 * 1000),
    });

    const doc = mdToYDoc("hella"); // tiny delta
    await ext.onStoreDocument!(
      storePayload({
        documentName: `note:${noteId}`,
        document: doc,
        context: { user: { id: u.id } },
      }),
    );

    const revs = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, noteId));
    expect(revs.length).toBe(1); // no new revision added
  });

  it("calls createRevisionIfNeeded — large edit above threshold DOES add a revision", async () => {
    const noteId = await makeNote("hello");

    await db.insert(noteRevisions).values({
      noteId,
      authorId: u.id,
      contentMd: "hello",
      reason: "autosave",
      createdAt: new Date(Date.now() - 60 * 1000),
    });

    const bigMd = "hello " + "x".repeat(100); // delta >> 50
    const doc = mdToYDoc(bigMd);
    await ext.onStoreDocument!(
      storePayload({
        documentName: `note:${noteId}`,
        document: doc,
        context: { user: { id: u.id } },
      }),
    );

    const revs = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, noteId));
    expect(revs.length).toBe(2); // new revision added
  });
});

describe("persistExt — onLoadDocument", () => {
  it("bootstraps Y.Doc from content_md when yjs_state is null", async () => {
    const noteId = await makeNote("# Bootstrap\n\nSeeded from markdown.");
    // Ensure yjs_state is null
    await db.update(notes).set({ yjsState: null }).where(eq(notes.id, noteId));

    const doc = new Y.Doc();
    await ext.onLoadDocument!(
      loadPayload({ documentName: `note:${noteId}`, document: doc }),
    );

    // The Y.Doc should have content in its "prosemirror" XmlFragment
    const fragment = doc.getXmlFragment("prosemirror");
    expect(fragment.length).toBeGreaterThan(0);
  });

  it("applies stored yjs_state when available, ignores content_md", async () => {
    const noteId = await makeNote("original md");

    // Store a Y.Doc with different content
    const storedDoc = mdToYDoc("stored via yjs");
    const state = Y.encodeStateAsUpdate(storedDoc);
    await db
      .update(notes)
      .set({ yjsState: state, contentMd: "original md" })
      .where(eq(notes.id, noteId));

    const doc = new Y.Doc();
    await ext.onLoadDocument!(
      loadPayload({ documentName: `note:${noteId}`, document: doc }),
    );

    // Should have applied the yjs state (not content_md)
    const fragment = doc.getXmlFragment("prosemirror");
    expect(fragment.length).toBeGreaterThan(0);
    // Verify the state matches the stored doc (not bootstrapped from content_md)
    const storedState = Y.encodeStateAsUpdate(storedDoc);
    const loadedState = Y.encodeStateAsUpdate(doc);
    // Both docs should encode to the same content (same XmlFragment)
    expect(
      doc.getXmlFragment("prosemirror").toJSON(),
    ).toBe(
      storedDoc.getXmlFragment("prosemirror").toJSON(),
    );
  });
});
