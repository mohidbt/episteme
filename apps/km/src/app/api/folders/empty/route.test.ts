import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { folders, notes } from "@episteme/db/schema";
import { POST } from "./route";
import { POST as POST_LIB } from "../../libraries/route";
import { createTestUser, deleteTestUser, req, type TestUser } from "../../_test-utils";

let u: TestUser;
let libraryId: number;
let trashId: string;

beforeAll(async () => {
  u = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Empty Lib" }),
    }),
  );
  libraryId = (await r.json()).id;

  // POST /api/libraries auto-seeds a Trash folder — look it up.
  const [tr] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.libraryId, libraryId), eq(folders.isTrash, true)))
    .limit(1);
  trashId = tr.id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("POST /api/folders/empty", () => {
  it("empties trash: deletes items + sub-folders, keeps trash", async () => {
    // seed: note under trash + sub-folder under trash
    await db.insert(notes).values({
      libraryId,
      userId: u.id,
      folderId: trashId,
      title: "trashed",
      slug: `trashed-${Date.now()}`,
      contentMd: "",
    });
    await db.insert(folders).values({
      libraryId,
      userId: u.id,
      parentId: trashId,
      name: "SubF",
    });

    const r = await POST(
      req("/api/folders/empty", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId }),
      }),
    );
    expect(r.status).toBe(204);

    const noteRows = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.userId, u.id), eq(notes.folderId, trashId)));
    expect(noteRows.length).toBe(0);

    const childFolders = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.userId, u.id), eq(folders.parentId, trashId)));
    expect(childFolders.length).toBe(0);

    const trashRows = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.userId, u.id), eq(folders.isTrash, true)));
    expect(trashRows.length).toBe(1);
  });

  it("already-empty trash → 204, trash intact", async () => {
    const r = await POST(
      req("/api/folders/empty", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId }),
      }),
    );
    expect(r.status).toBe(204);

    const trashRows = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.userId, u.id), eq(folders.isTrash, true)));
    expect(trashRows.length).toBe(1);
  });

  it("no session → 401", async () => {
    const r = await POST(
      req("/api/folders/empty", {
        method: "POST",
        body: JSON.stringify({ libraryId }),
      }),
    );
    expect(r.status).toBe(401);
  });
});
