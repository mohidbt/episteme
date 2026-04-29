import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers, papersets, libraries } from "@episteme/db/schema";
import { DELETE, POST } from "./route";
import { POST as POST_PAPERSET } from "../../route";
import { POST as POST_LIB } from "../../../libraries/route";
import { createTestUser, deleteTestUser, params, req, type TestUser } from "../../../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;
let otherLibraryId: number;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();

  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Rows Lib" }) }),
  );
  libraryId = (await r.json()).id;

  const r2 = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: other.cookie, body: JSON.stringify({ name: "Rows Other Lib" }) }),
  );
  otherLibraryId = (await r2.json()).id;
}, 60_000);

afterAll(async () => {
  await db.delete(papers).where(eq(papers.userId, u.id));
  await db.delete(papers).where(eq(papers.userId, other.id));
  await db.delete(libraries).where(eq(libraries.id, libraryId));
  await db.delete(libraries).where(eq(libraries.id, otherLibraryId));
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

async function seedPaperset(): Promise<string> {
  const r = await POST_PAPERSET(
    req("/api/papersets", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        filename: "rows.csv",
        folderId: null,
        columns: [{ name: "x", description: "y" }],
      }),
    }),
  );
  if (r.status !== 201) throw new Error(`seed paperset failed: ${r.status}`);
  return (await r.json()).id as string;
}

async function seedPaper(opts: { userId?: string; libId?: number; filename?: string } = {}): Promise<string> {
  const userId = opts.userId ?? u.id;
  const libId = opts.libId ?? (userId === u.id ? libraryId : otherLibraryId);
  const [row] = await db
    .insert(papers)
    .values({
      userId,
      libraryId: libId,
      filename: opts.filename ?? `paper-${Math.random().toString(36).slice(2, 8)}.pdf`,
    })
    .returning({ id: papers.id });
  return row.id;
}

describe("POST /api/papersets/:id/rows", () => {
  it("appends paper rows", async () => {
    const id = await seedPaperset();
    const paperA = await seedPaper();
    const paperB = await seedPaper();
    const r = await POST(
      req(`/api/papersets/${id}/rows`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperIds: [paperA, paperB] }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.rowRefs).toEqual([{ paper_id: paperA }, { paper_id: paperB }]);
  });

  it("rejects duplicate paper without confirmDuplicates flag", async () => {
    const id = await seedPaperset();
    const paperA = await seedPaper();
    await POST(
      req(`/api/papersets/${id}/rows`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperIds: [paperA] }),
      }),
      params({ id }),
    );
    const r = await POST(
      req(`/api/papersets/${id}/rows`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperIds: [paperA] }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("duplicate_paper");
  });

  it("allows duplicate when confirmDuplicates:true", async () => {
    const id = await seedPaperset();
    const paperA = await seedPaper();
    await POST(
      req(`/api/papersets/${id}/rows`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperIds: [paperA] }),
      }),
      params({ id }),
    );
    const r = await POST(
      req(`/api/papersets/${id}/rows`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperIds: [paperA], confirmDuplicates: true }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.rowRefs).toEqual([{ paper_id: paperA }, { paper_id: paperA }]);
  });

  it("rejects paper not owned by user", async () => {
    const id = await seedPaperset();
    const foreignPaper = await seedPaper({ userId: other.id });
    const r = await POST(
      req(`/api/papersets/${id}/rows`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperIds: [foreignPaper] }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("paper_not_owned");
  });

  it("rejects nonexistent paper id", async () => {
    const id = await seedPaperset();
    const fake = "00000000-0000-0000-0000-000000000000";
    const r = await POST(
      req(`/api/papersets/${id}/rows`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperIds: [fake] }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(403);
  });

  it("403 on cross-user paperset", async () => {
    const id = await seedPaperset();
    const paperA = await seedPaper({ userId: other.id });
    const r = await POST(
      req(`/api/papersets/${id}/rows`, {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({ paperIds: [paperA] }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(403);
  });

  it("401 unauthenticated", async () => {
    const id = await seedPaperset();
    const r = await POST(
      req(`/api/papersets/${id}/rows`, {
        method: "POST",
        body: JSON.stringify({ paperIds: [] }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(401);
  });
});

describe("DELETE /api/papersets/:id/rows", () => {
  it("removes row by index", async () => {
    const id = await seedPaperset();
    const paperA = await seedPaper();
    const paperB = await seedPaper();
    const paperC = await seedPaper();
    await POST(
      req(`/api/papersets/${id}/rows`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperIds: [paperA, paperB, paperC] }),
      }),
      params({ id }),
    );
    const r = await DELETE(
      req(`/api/papersets/${id}/rows?index=1`, { method: "DELETE", cookie: u.cookie }),
      params({ id }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.rowRefs).toEqual([{ paper_id: paperA }, { paper_id: paperC }]);
  });

  it("shifts cell_grounding entries down to match new row indices", async () => {
    const id = await seedPaperset();
    const paperA = await seedPaper();
    const paperB = await seedPaper();
    const paperC = await seedPaper();
    await POST(
      req(`/api/papersets/${id}/rows`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperIds: [paperA, paperB, paperC] }),
      }),
      params({ id }),
    );
    const groundingA = { x: { paper_id: paperA, block_ids: ["a"] } };
    const groundingB = { x: { paper_id: paperB, block_ids: ["b"] } };
    const groundingC = { x: { paper_id: paperC, block_ids: ["c"] } };
    await db
      .update(papersets)
      .set({ cellGrounding: { "0": groundingA, "1": groundingB, "2": groundingC } })
      .where(eq(papersets.id, id));

    const r = await DELETE(
      req(`/api/papersets/${id}/rows?index=1`, { method: "DELETE", cookie: u.cookie }),
      params({ id }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.cellGrounding).toEqual({ "0": groundingA, "1": groundingC });
  });

  it("400 on out-of-range index", async () => {
    const id = await seedPaperset();
    const paperA = await seedPaper();
    await POST(
      req(`/api/papersets/${id}/rows`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperIds: [paperA] }),
      }),
      params({ id }),
    );
    const r = await DELETE(
      req(`/api/papersets/${id}/rows?index=5`, { method: "DELETE", cookie: u.cookie }),
      params({ id }),
    );
    expect(r.status).toBe(400);
  });

  it("400 on missing index", async () => {
    const id = await seedPaperset();
    const r = await DELETE(
      req(`/api/papersets/${id}/rows`, { method: "DELETE", cookie: u.cookie }),
      params({ id }),
    );
    expect(r.status).toBe(400);
  });

  it("403 on cross-user DELETE", async () => {
    const id = await seedPaperset();
    const r = await DELETE(
      req(`/api/papersets/${id}/rows?index=0`, { method: "DELETE", cookie: other.cookie }),
      params({ id }),
    );
    expect(r.status).toBe(403);
  });
});
