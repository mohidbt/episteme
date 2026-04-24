import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { DELETE, GET } from "./route";
import { POST as POST_NOTE } from "../route";
import { POST as POST_LIB } from "../../libraries/route";
import { createTestUser, deleteTestUser, params, req, type TestUser } from "../../_test-utils";
import { getTrashFolderId } from "@/lib/folders-server";

let u: TestUser;
let libraryId: number;

beforeAll(async () => {
  u = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Notes DELETE Guard Lib" }) }),
  );
  libraryId = (await r.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

async function createNote(title = "Test Note"): Promise<string> {
  const r = await POST_NOTE(
    req("/api/notes", { method: "POST", cookie: u.cookie, body: JSON.stringify({ libraryId, title }) }),
  );
  if (r.status !== 201) throw new Error(`create note failed: ${r.status}`);
  return (await r.json()).id as string;
}

describe("DELETE /api/notes/:id — trash guard (T20)", () => {
  it("400 rejects delete when note is not in trash", async () => {
    const noteId = await createNote("Not In Trash");
    const r = await DELETE(
      req(`/api/notes/${noteId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("items must be in trash before permanent delete");
  });

  it("204 deletes note when it is in trash", async () => {
    const noteId = await createNote("In Trash Note");
    const trashId = await getTrashFolderId(libraryId, u.id);
    // Move to trash directly via DB
    await db.update(notes).set({ folderId: trashId }).where(eq(notes.id, noteId));

    const r = await DELETE(
      req(`/api/notes/${noteId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(204);

    // Row gone
    const [row] = await db.select({ id: notes.id }).from(notes).where(eq(notes.id, noteId));
    expect(row).toBeUndefined();
  });
});
