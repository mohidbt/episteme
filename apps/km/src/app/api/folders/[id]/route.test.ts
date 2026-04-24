import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { folders } from "@episteme/db/schema";
import { PATCH } from "./route";
import { POST as POST_FOLDER } from "../route";
import { POST as POST_LIB } from "../../libraries/route";
import { createTestUser, deleteTestUser, req, params, type TestUser } from "../../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Rename Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

async function createFolderVia(name: string, parentId: string | null = null): Promise<string> {
  const r = await POST_FOLDER(
    req("/api/folders", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, parentId, name }),
    }),
  );
  if (r.status !== 201) throw new Error(`create folder failed: ${r.status}`);
  return (await r.json()).id as string;
}

async function getFolderName(id: string): Promise<string | undefined> {
  const rows = await db.select({ name: folders.name }).from(folders).where(eq(folders.id, id));
  return rows[0]?.name;
}

async function ensureTrashFolderId(): Promise<string> {
  const [existing] = await db.select({ id: folders.id }).from(folders)
    .where(and(eq(folders.libraryId, libraryId), eq(folders.userId, u.id), eq(folders.isTrash, true)))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db.insert(folders).values({
    libraryId, userId: u.id, parentId: null, name: "Trash", isTrash: true,
  }).returning({ id: folders.id });
  return row.id;
}

describe("PATCH /api/folders/[id]", () => {
  it("renames the folder (204, DB reflects new name)", async () => {
    const id = await createFolderVia("Original");
    const r = await PATCH(
      req(`/api/folders/${id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ name: "Renamed" }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(204);
    expect(await getFolderName(id)).toBe("Renamed");
  });

  it("rejects reserved name 'trash' (400, case-insensitive)", async () => {
    const id = await createFolderVia("SomeFolder");
    const r = await PATCH(
      req(`/api/folders/${id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ name: "trash" }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(400);
  });

  it("rejects renaming the trash folder itself (400)", async () => {
    const trashId = await ensureTrashFolderId();
    const r = await PATCH(
      req(`/api/folders/${trashId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ name: "NotTrash" }),
      }),
      params({ id: trashId }),
    );
    expect(r.status).toBe(400);
  });

  it("cross-user → 404", async () => {
    const id = await createFolderVia("CrossUser");
    const r = await PATCH(
      req(`/api/folders/${id}`, {
        method: "PATCH",
        cookie: other.cookie,
        body: JSON.stringify({ name: "Hijacked" }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(404);
  });

  it("duplicate sibling name (same parentId) → 409", async () => {
    await createFolderVia("Alpha");
    const betaId = await createFolderVia("Beta");
    const r = await PATCH(
      req(`/api/folders/${betaId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ name: "Alpha" }),
      }),
      params({ id: betaId }),
    );
    expect(r.status).toBe(409);
  });
});
