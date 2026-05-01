import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { papers, papersets, libraries } from "@episteme/db/schema";
import { GET } from "./route";
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
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "CsvView Lib" }) }),
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
        filename: `csvview-${Math.random().toString(36).slice(2, 8)}.csv`,
        folderId: null,
        columns: [
          { name: "n_subjects", description: "Subject count from Methods" },
          { name: "study_type", description: "RCT / observational / meta" },
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

describe("GET /api/papersets/:id/csv-view", () => {
  it("rejects unauth", async () => {
    const res = await GET(
      new Request("http://x/api/papersets/00000000-0000-0000-0000-000000000000/csv-view"),
      params({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(res.status).toBe(401);
  });

  it("404 on missing paperset", async () => {
    const res = await GET(
      req(`/api/papersets/00000000-0000-0000-0000-000000000000/csv-view`, { cookie: u.cookie }),
      params({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(res.status).toBe(404);
  });

  it("403 on cross-user paperset", async () => {
    const id = await seedPaperset();
    const res = await GET(
      req(`/api/papersets/${id}/csv-view`, { cookie: other.cookie }),
      params({ id }),
    );
    expect(res.status).toBe(403);
  });

  it("returns {file_id, columns, row_refs, cells} for owned paperset", async () => {
    const id = await seedPaperset();
    const paper = await seedPaper();
    await addRow(id, paper);

    // Pre-populate content via a direct DB write so we can assert cells parsing.
    await db
      .update(papersets)
      .set({ content: `Reference,n_subjects,study_type\n${paper},42,RCT` })
      .where(eq(papersets.id, id));

    const res = await GET(
      req(`/api/papersets/${id}/csv-view`, { cookie: u.cookie }),
      params({ id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.file_id).toBe(id);
    expect(body.columns.map((c: { name: string }) => c.name)).toEqual(["n_subjects", "study_type"]);
    expect(body.row_refs).toEqual([{ paper_id: paper }]);
    expect(body.cells).toEqual({ "0:n_subjects": "42", "0:study_type": "RCT" });
  });
});
