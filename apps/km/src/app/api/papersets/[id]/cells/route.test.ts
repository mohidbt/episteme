import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { papers, papersets, libraries } from "@episteme/db/schema";
import { PATCH } from "./route";
import { POST as POST_PAPERSET } from "../../route";
import { POST as POST_ROWS } from "../rows/route";
import { POST as POST_LIB } from "../../../libraries/route";
import { createTestUser, deleteTestUser, params, req, type TestUser } from "../../../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Cells Lib" }) }),
  );
  libraryId = (await r.json()).id;
}, 60_000);

afterAll(async () => {
  await db.delete(papers).where(eq(papers.userId, u.id));
  await db.delete(libraries).where(eq(libraries.id, libraryId));
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

beforeEach(() => {
  process.env.INHALE_INTERNAL_SECRET = "test-secret-abc";
});

afterEach(() => {
  delete process.env.INHALE_INTERNAL_SECRET;
});

async function seedPaperset(): Promise<string> {
  const r = await POST_PAPERSET(
    req("/api/papersets", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        filename: `cells-${Math.random().toString(36).slice(2, 8)}.csv`,
        folderId: null,
        columns: [
          { name: "n_subjects", description: "Subject count from Methods" },
        ],
      }),
    }),
  );
  if (r.status !== 201) throw new Error(`seed paperset failed: ${r.status}`);
  return (await r.json()).id as string;
}

async function seedPaper(): Promise<string> {
  const [row] = await db
    .insert(papers)
    .values({
      userId: u.id,
      libraryId,
      filename: `paper-${Math.random().toString(36).slice(2, 8)}.pdf`,
    })
    .returning({ id: papers.id });
  return row.id;
}

async function addRow(papersetId: string, paperId: string): Promise<void> {
  await POST_ROWS(
    req(`/api/papersets/${papersetId}/rows`, {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ paperIds: [paperId] }),
    }),
    params({ id: papersetId }),
  );
}

const G = { paper_id: "p-1", block_ids: ["p-1:7"] };

describe("PATCH /api/papersets/:id/cells", () => {
  it("rejects unauth", async () => {
    const res = await PATCH(
      new Request("http://x/api/papersets/00000000-0000-0000-0000-000000000000/cells", {
        method: "PATCH",
        body: JSON.stringify({ row: 0, col: "n_subjects", value: "42", grounding: G }),
        headers: { "content-type": "application/json" },
      }),
      params({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(res.status).toBe(401);
  });

  it("404 on missing paperset", async () => {
    const res = await PATCH(
      req(`/api/papersets/00000000-0000-0000-0000-000000000000/cells`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ row: 0, col: "n_subjects", value: "42", grounding: G }),
      }),
      params({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(res.status).toBe(404);
  });

  it("403 on cross-user", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);
    const res = await PATCH(
      req(`/api/papersets/${id}/cells`, {
        method: "PATCH",
        cookie: other.cookie,
        body: JSON.stringify({ row: 0, col: "n_subjects", value: "42", grounding: G }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(403);
  });

  it("200 writes cell + grounding", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);
    const res = await PATCH(
      req(`/api/papersets/${id}/cells`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ row: 0, col: "n_subjects", value: "42", grounding: G }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(200);
    const [updated] = await db.select().from(papersets).where(eq(papersets.id, id));
    expect(updated.content).toContain("42");
    expect((updated.cellGrounding as Record<string, Record<string, unknown>>)["0"].n_subjects).toEqual(G);
  });

  it("400 row out of range", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);
    const res = await PATCH(
      req(`/api/papersets/${id}/cells`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ row: 9, col: "n_subjects", value: "42", grounding: G }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("row_oob");
  });

  it("400 unknown col", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);
    const res = await PATCH(
      req(`/api/papersets/${id}/cells`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ row: 0, col: "nope", value: "42", grounding: G }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown_col");
  });

  it("400 grounding_required when block_ids empty for non-n/a", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);
    const res = await PATCH(
      req(`/api/papersets/${id}/cells`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({
          row: 0,
          col: "n_subjects",
          value: "42",
          grounding: { paper_id: paper, block_ids: [] },
        }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("grounding_required");
  });

  it("200 allows n/a value with empty block_ids", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);
    const res = await PATCH(
      req(`/api/papersets/${id}/cells`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({
          row: 0,
          col: "n_subjects",
          value: "n/a",
          grounding: { paper_id: paper, block_ids: [] },
        }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(200);
  });

  it("idempotent retry: same value on filled cell returns 200", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);
    await PATCH(
      req(`/api/papersets/${id}/cells`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ row: 0, col: "n_subjects", value: "42", grounding: G }),
      }),
      params({ id }),
    );
    const res = await PATCH(
      req(`/api/papersets/${id}/cells`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ row: 0, col: "n_subjects", value: "42", grounding: G }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(200);
  });

  it("400 cell_filled when overwrite with different value", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);
    await PATCH(
      req(`/api/papersets/${id}/cells`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ row: 0, col: "n_subjects", value: "42", grounding: G }),
      }),
      params({ id }),
    );
    const res = await PATCH(
      req(`/api/papersets/${id}/cells`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ row: 0, col: "n_subjects", value: "99", grounding: G }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("cell_filled");
  });
});
