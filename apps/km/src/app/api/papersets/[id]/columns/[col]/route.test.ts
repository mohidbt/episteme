import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papersets, libraries } from "@episteme/db/schema";
import { DELETE, PATCH } from "./route";
import { POST as POST_PAPERSET } from "../../../route";
import { POST as POST_LIB } from "../../../../libraries/route";
import { createTestUser, deleteTestUser, req, type TestUser } from "../../../../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;
let otherLibraryId: number;

function colParams(p: { id: string; col: string }) {
  return { params: Promise.resolve(p) };
}

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();

  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Col Lib" }) }),
  );
  libraryId = (await r.json()).id;

  const r2 = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: other.cookie, body: JSON.stringify({ name: "Col Other Lib" }) }),
  );
  otherLibraryId = (await r2.json()).id;
}, 60_000);

afterAll(async () => {
  await db.delete(libraries).where(eq(libraries.id, libraryId));
  await db.delete(libraries).where(eq(libraries.id, otherLibraryId));
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

async function seedPaperset(columns: Array<{ name: string; description: string }>): Promise<string> {
  const r = await POST_PAPERSET(
    req("/api/papersets", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ filename: "cols.csv", folderId: null, columns }),
    }),
  );
  if (r.status !== 201) throw new Error(`seed paperset failed: ${r.status}`);
  return (await r.json()).id as string;
}

describe("PATCH /api/papersets/:id/columns/:col", () => {
  it("updates description without invalidating cell_grounding", async () => {
    const id = await seedPaperset([{ name: "x", description: "old" }]);
    await db
      .update(papersets)
      .set({ cellGrounding: { "0": { x: { paper_id: "p1", block_ids: ["b1"] } } } })
      .where(eq(papersets.id, id));

    const r = await PATCH(
      req(`/api/papersets/${id}/columns/x`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ description: "new" }),
      }),
      colParams({ id, col: "x" }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.columns.find((c: { name: string }) => c.name === "x").description).toBe("new");
    expect(body.cellGrounding["0"].x.block_ids).toEqual(["b1"]);
  });

  it("404 on unknown col", async () => {
    const id = await seedPaperset([{ name: "x", description: "d" }]);
    const r = await PATCH(
      req(`/api/papersets/${id}/columns/missing`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ description: "new" }),
      }),
      colParams({ id, col: "missing" }),
    );
    expect(r.status).toBe(404);
  });

  it("400 on empty description", async () => {
    const id = await seedPaperset([{ name: "x", description: "d" }]);
    const r = await PATCH(
      req(`/api/papersets/${id}/columns/x`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ description: "" }),
      }),
      colParams({ id, col: "x" }),
    );
    expect(r.status).toBe(400);
  });

  it("401 unauthenticated", async () => {
    const id = await seedPaperset([{ name: "x", description: "d" }]);
    const r = await PATCH(
      req(`/api/papersets/${id}/columns/x`, {
        method: "PATCH",
        body: JSON.stringify({ description: "new" }),
      }),
      colParams({ id, col: "x" }),
    );
    expect(r.status).toBe(401);
  });

  it("403 cross-user", async () => {
    const id = await seedPaperset([{ name: "x", description: "d" }]);
    const r = await PATCH(
      req(`/api/papersets/${id}/columns/x`, {
        method: "PATCH",
        cookie: other.cookie,
        body: JSON.stringify({ description: "new" }),
      }),
      colParams({ id, col: "x" }),
    );
    expect(r.status).toBe(403);
  });
});

describe("DELETE /api/papersets/:id/columns/:col", () => {
  it("removes column and clears its cell_grounding entries", async () => {
    const id = await seedPaperset([
      { name: "x", description: "dx" },
      { name: "y", description: "dy" },
    ]);
    await db
      .update(papersets)
      .set({
        cellGrounding: {
          "0": {
            x: { paper_id: "p1", block_ids: ["bx0"] },
            y: { paper_id: "p1", block_ids: ["by0"] },
          },
          "1": {
            x: { paper_id: "p2", block_ids: ["bx1"] },
          },
        },
      })
      .where(eq(papersets.id, id));

    const r = await DELETE(
      req(`/api/papersets/${id}/columns/x`, { method: "DELETE", cookie: u.cookie }),
      colParams({ id, col: "x" }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.columns.map((c: { name: string }) => c.name)).toEqual(["y"]);
    expect(body.cellGrounding["0"]).toEqual({ y: { paper_id: "p1", block_ids: ["by0"] } });
    expect(body.cellGrounding["1"]).toBeUndefined();
  });

  it("404 on unknown col", async () => {
    const id = await seedPaperset([
      { name: "x", description: "dx" },
      { name: "y", description: "dy" },
    ]);
    const r = await DELETE(
      req(`/api/papersets/${id}/columns/missing`, { method: "DELETE", cookie: u.cookie }),
      colParams({ id, col: "missing" }),
    );
    expect(r.status).toBe(404);
  });

  it("400 when removing the last column", async () => {
    const id = await seedPaperset([{ name: "x", description: "d" }]);
    const r = await DELETE(
      req(`/api/papersets/${id}/columns/x`, { method: "DELETE", cookie: u.cookie }),
      colParams({ id, col: "x" }),
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("last_column");
  });

  it("401 unauthenticated", async () => {
    const id = await seedPaperset([
      { name: "x", description: "dx" },
      { name: "y", description: "dy" },
    ]);
    const r = await DELETE(
      req(`/api/papersets/${id}/columns/x`, { method: "DELETE" }),
      colParams({ id, col: "x" }),
    );
    expect(r.status).toBe(401);
  });

  it("403 cross-user", async () => {
    const id = await seedPaperset([
      { name: "x", description: "dx" },
      { name: "y", description: "dy" },
    ]);
    const r = await DELETE(
      req(`/api/papersets/${id}/columns/x`, { method: "DELETE", cookie: other.cookie }),
      colParams({ id, col: "x" }),
    );
    expect(r.status).toBe(403);
  });
});
