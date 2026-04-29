import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papersets } from "@episteme/db/schema";
import { DELETE, GET, PATCH } from "./route";
import { POST as POST_PAPERSET } from "../route";
import { POST as POST_LIB } from "../../libraries/route";
import { POST as POST_FOLDER } from "../../folders/route";
import { createTestUser, deleteTestUser, params, req, type TestUser } from "../../_test-utils";
import { getTrashFolderId } from "@/lib/folders-server";

let u: TestUser;
let other: TestUser;
let libraryId: number;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Paperset [id] Lib" }) }),
  );
  libraryId = (await r.json()).id;
  await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: other.cookie, body: JSON.stringify({ name: "other Lib" }) }),
  );
}, 60_000);

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

async function seedPaperset(opts: { cookie?: string; filename?: string; folderId?: string | null } = {}): Promise<string> {
  const cookie = opts.cookie ?? u.cookie;
  const r = await POST_PAPERSET(
    req("/api/papersets", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        filename: opts.filename ?? "seed.csv",
        folderId: opts.folderId ?? null,
        columns: [{ name: "x", description: "y" }],
      }),
    }),
  );
  if (r.status !== 201) throw new Error(`seed paperset failed: ${r.status}`);
  return (await r.json()).id as string;
}

async function seedFolder(name = "Target"): Promise<string> {
  const r = await POST_FOLDER(
    req("/api/folders", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, parentId: null, name }),
    }),
  );
  if (r.status !== 201) throw new Error(`seed folder failed: ${r.status}`);
  return (await r.json()).id as string;
}

describe("GET /api/papersets/:id", () => {
  it("401 unauthenticated", async () => {
    const id = await seedPaperset();
    const r = await GET(req(`/api/papersets/${id}`), params({ id }));
    expect(r.status).toBe(401);
  });

  it("200 returns owned paperset", async () => {
    const id = await seedPaperset({ filename: "owned.csv" });
    const r = await GET(req(`/api/papersets/${id}`, { cookie: u.cookie }), params({ id }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.id).toBe(id);
    expect(body.filename).toBe("owned.csv");
    // Drizzle returns camelCase
    expect(body.rowRefs).toEqual([]);
    expect(body.cellGrounding).toEqual({});
  });

  it("404 on non-existent id", async () => {
    const fake = "00000000-0000-0000-0000-000000000000";
    const r = await GET(req(`/api/papersets/${fake}`, { cookie: u.cookie }), params({ id: fake }));
    expect(r.status).toBe(404);
  });

  it("403 on cross-user access", async () => {
    const id = await seedPaperset();
    const r = await GET(req(`/api/papersets/${id}`, { cookie: other.cookie }), params({ id }));
    expect(r.status).toBe(403);
  });
});

describe("PATCH /api/papersets/:id", () => {
  it("renames paperset", async () => {
    const id = await seedPaperset();
    const r = await PATCH(
      req(`/api/papersets/${id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ filename: "renamed.csv" }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).filename).toBe("renamed.csv");
  });

  it("auto-suffixes .csv on rename", async () => {
    const id = await seedPaperset();
    const r = await PATCH(
      req(`/api/papersets/${id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ filename: "no-ext" }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).filename).toBe("no-ext.csv");
  });

  it("moves to folder", async () => {
    const id = await seedPaperset();
    const targetFolderId = await seedFolder("Move Target");
    const r = await PATCH(
      req(`/api/papersets/${id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ folderId: targetFolderId }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).folderId).toBe(targetFolderId);
  });

  it("updates columns", async () => {
    const id = await seedPaperset();
    const cols = [
      { name: "method", description: "what method?" },
      { name: "n", description: "sample size" },
    ];
    const r = await PATCH(
      req(`/api/papersets/${id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ columns: cols }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).columns).toEqual(cols);
  });

  it("rejects empty columns array", async () => {
    const id = await seedPaperset();
    const r = await PATCH(
      req(`/api/papersets/${id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ columns: [] }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(400);
  });

  it("rejects filename with path separator", async () => {
    const id = await seedPaperset();
    const r = await PATCH(
      req(`/api/papersets/${id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ filename: "foo/bar.csv" }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(400);
  });

  it("403 on cross-user PATCH", async () => {
    const id = await seedPaperset();
    const r = await PATCH(
      req(`/api/papersets/${id}`, {
        method: "PATCH",
        cookie: other.cookie,
        body: JSON.stringify({ filename: "hijack.csv" }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(403);
  });

  it("404 on non-existent id", async () => {
    const fake = "00000000-0000-0000-0000-000000000000";
    const r = await PATCH(
      req(`/api/papersets/${fake}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ filename: "x.csv" }),
      }),
      params({ id: fake }),
    );
    expect(r.status).toBe(404);
  });
});

describe("DELETE /api/papersets/:id", () => {
  it("204 soft-deletes (moves to trash, sets prevFolderId)", async () => {
    const folderId = await seedFolder("Pre-trash Folder");
    const id = await seedPaperset({ folderId });
    const r = await DELETE(
      req(`/api/papersets/${id}`, { method: "DELETE", cookie: u.cookie }),
      params({ id }),
    );
    expect(r.status).toBe(204);
    const [row] = await db.select().from(papersets).where(eq(papersets.id, id));
    const trashId = await getTrashFolderId(libraryId, u.id);
    expect(row.folderId).toBe(trashId);
    expect(row.prevFolderId).toBe(folderId);
  });

  it("403 on cross-user DELETE", async () => {
    const id = await seedPaperset();
    const r = await DELETE(
      req(`/api/papersets/${id}`, { method: "DELETE", cookie: other.cookie }),
      params({ id }),
    );
    expect(r.status).toBe(403);
  });

  it("404 on non-existent id", async () => {
    const fake = "00000000-0000-0000-0000-000000000000";
    const r = await DELETE(
      req(`/api/papersets/${fake}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: fake }),
    );
    expect(r.status).toBe(404);
  });
});
