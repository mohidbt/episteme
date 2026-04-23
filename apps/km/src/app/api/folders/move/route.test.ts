import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { folders } from "@episteme/db/schema";
import { POST } from "./route";
import { POST as POST_FOLDER } from "../route";
import { POST as POST_LIB } from "../../libraries/route";
import { createTestUser, deleteTestUser, req, type TestUser } from "../../_test-utils";

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
      body: JSON.stringify({ name: "Move Lib" }),
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

async function getParentId(id: string): Promise<string | null | undefined> {
  const rows = await db.select({ parentId: folders.parentId }).from(folders).where(eq(folders.id, id));
  return rows[0]?.parentId;
}

describe("POST /api/folders/move", () => {
  it("moves C to root (204, parentId = null)", async () => {
    const a = await createFolderVia("A-root1");
    const b = await createFolderVia("B-root1", a);
    const c = await createFolderVia("C-root1", b);
    const r = await POST(
      req("/api/folders/move", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ folderId: c, targetParentId: null }),
      }),
    );
    expect(r.status).toBe(204);
    expect(await getParentId(c)).toBeNull();
  });

  it("rejects moving B under C (cycle: B is ancestor of C) → 400", async () => {
    const a = await createFolderVia("A-cyc1");
    const b = await createFolderVia("B-cyc1", a);
    const c = await createFolderVia("C-cyc1", b);
    const r = await POST(
      req("/api/folders/move", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ folderId: b, targetParentId: c }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("rejects moving A under B (cycle: A is ancestor of B) → 400", async () => {
    const a = await createFolderVia("A-cyc2");
    const b = await createFolderVia("B-cyc2", a);
    const r = await POST(
      req("/api/folders/move", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ folderId: a, targetParentId: b }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("moves A to root (already root, 204)", async () => {
    const a = await createFolderVia("A-root2");
    const r = await POST(
      req("/api/folders/move", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ folderId: a, targetParentId: null }),
      }),
    );
    expect(r.status).toBe(204);
    expect(await getParentId(a)).toBeNull();
  });

  it("rejects moving the trash folder → 400", async () => {
    const [row] = await db.insert(folders).values({
      libraryId, userId: u.id, parentId: null, name: "Trash-move", isTrash: true,
    }).returning({ id: folders.id });
    const r = await POST(
      req("/api/folders/move", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ folderId: row.id, targetParentId: null }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("cross-user → 404", async () => {
    const a = await createFolderVia("A-xuser");
    const r = await POST(
      req("/api/folders/move", {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({ folderId: a, targetParentId: null }),
      }),
    );
    expect(r.status).toBe(404);
  });
});
