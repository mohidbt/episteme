import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, references_ } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";
import { getReferenceCitedIn } from "../reference-cited-in";

let u: TestUser;
let libraryId: number;
let refId: string;
let paperAId: string;
let paperBId: string;

beforeAll(async () => {
  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Cited-In Test Library" })
    .returning({ id: libraries.id });
  libraryId = lib.id;

  // Seed two papers
  const papers = await db.execute(sql`
    INSERT INTO papers (user_id, library_id, filename, title)
    VALUES (${u.id}, ${libraryId}, 'a.pdf', 'Paper A — Citer'),
           (${u.id}, ${libraryId}, 'b.pdf', 'Paper B — Other')
    RETURNING id
  `);
  const rows = (papers as { rows?: { id: string }[] }).rows ?? (papers as unknown as { id: string }[]);
  paperAId = rows[0]!.id;
  paperBId = rows[1]!.id;

  // Seed one reference
  const [ref] = await db
    .insert(references_)
    .values({
      libraryId,
      userId: u.id,
      citationKey: `cited-in-${Date.now()}`,
      cslJson: { title: "Target Reference" },
      folderPath: "",
    })
    .returning({ id: references_.id });
  refId = ref.id;

  // paper_citations row: paperA cites this reference
  await db.execute(sql`
    INSERT INTO paper_citations (citer_kind, citer_id, cited_kind, cited_id, source_marker_idx, match_method)
    VALUES ('paper', ${paperAId}, 'reference', ${refId}, 7, 'manual')
  `);
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM paper_citations WHERE cited_id = ${refId}`);
  await db.execute(sql`DELETE FROM "references" WHERE id = ${refId}`);
  await db.execute(sql`DELETE FROM papers WHERE id IN (${paperAId}, ${paperBId})`);
  await deleteTestUser(u.id);
});

describe("getReferenceCitedIn", () => {
  it("returns papers that cite the reference (cited_kind='reference', cited_id=refId)", async () => {
    const rows = await getReferenceCitedIn(refId, u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      paperId: paperAId,
      title: "Paper A — Citer",
      markerIdx: 7,
    });
  });

  it("excludes papers from other users (cross-user isolation)", async () => {
    const other = await createTestUser();
    try {
      const rows = await getReferenceCitedIn(refId, other.id);
      expect(rows).toHaveLength(0);
    } finally {
      await deleteTestUser(other.id);
    }
  });
});
