import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { folders, notes } from "@episteme/db/schema";
import { POST } from "./route";
import { POST as POST_FOLDER } from "../route";
import { POST as POST_LIB } from "../../libraries/route";
import { moveToTrash } from "@/lib/folders-server";
import { createTestUser, deleteTestUser, req, type TestUser } from "../../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;
let otherLibraryId: number;
let trashId: string;
let folderXId: string;
let noteId: string;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Restore Lib" }),
    }),
  );
  libraryId = (await r.json()).id;

  const rOther = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: other.cookie,
      body: JSON.stringify({ name: "Other Lib" }),
    }),
  );
  otherLibraryId = (await rOther.json()).id;

  // POST /api/libraries auto-seeds a Trash folder — look it up.
  const [tr] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.libraryId, libraryId), eq(folders.isTrash, true)))
    .limit(1);
  trashId = tr.id;

  const fRes = await POST_FOLDER(
    req("/api/folders", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, parentId: null, name: "X" }),
    }),
  );
  folderXId = (await fRes.json()).id;

  const [n] = await db
    .insert(notes)
    .values({
      libraryId,
      userId: u.id,
      folderId: folderXId,
      title: "N",
      slug: `n-restore-${Date.now()}`,
      contentMd: "",
    })
    .returning({ id: notes.id });
  noteId = n.id;

  await moveToTrash({
    libraryId,
    userId: u.id,
    target: { kind: "note", id: noteId },
  });
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("POST /api/folders/restore", () => {
  it("restores a note → 204; folderId=X, prevFolderId=null", async () => {
    const r = await POST(
      req("/api/folders/restore", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          libraryId,
          target: { kind: "note", id: noteId },
        }),
      }),
    );
    expect(r.status).toBe(204);
    const [row] = await db
      .select({ folderId: notes.folderId, prev: notes.prevFolderId })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(row.folderId).toBe(folderXId);
    expect(row.prev).toBe(null);
  });

  it("restores a trashed folder → 204; parentId=null", async () => {
    const fRes = await POST_FOLDER(
      req("/api/folders", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, parentId: null, name: "F-trashed" }),
      }),
    );
    const fId = (await fRes.json()).id as string;
    await moveToTrash({
      libraryId,
      userId: u.id,
      target: { kind: "folder", id: fId },
    });

    const r = await POST(
      req("/api/folders/restore", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          libraryId,
          target: { kind: "folder", id: fId },
        }),
      }),
    );
    expect(r.status).toBe(204);
    const [row] = await db
      .select({ parentId: folders.parentId })
      .from(folders)
      .where(eq(folders.id, fId));
    expect(row.parentId).toBe(null);
  });

  it("cross-user → 404", async () => {
    const fRes = await POST_FOLDER(
      req("/api/folders", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, parentId: null, name: "F-xuser-restore" }),
      }),
    );
    const fId = (await fRes.json()).id as string;
    const [n] = await db
      .insert(notes)
      .values({
        libraryId,
        userId: u.id,
        folderId: fId,
        title: "Nx",
        slug: `nx-restore-${Date.now()}`,
        contentMd: "",
      })
      .returning({ id: notes.id });
    await moveToTrash({
      libraryId,
      userId: u.id,
      target: { kind: "note", id: n.id },
    });
    const r = await POST(
      req("/api/folders/restore", {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({
          libraryId: otherLibraryId,
          target: { kind: "note", id: n.id },
        }),
      }),
    );
    expect(r.status).toBe(404);
  });

  it("bad body (missing target.kind) → 400", async () => {
    const r = await POST(
      req("/api/folders/restore", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          libraryId,
          target: { id: "00000000-0000-0000-0000-000000000000" },
        }),
      }),
    );
    expect(r.status).toBe(400);
  });
});
