import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, references_ } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";
import { findIdentityPaperForReference } from "../identity-match";

// Step 6 (H-batch): identity match between a library reference and a library
// paper. Mirrors edgesPaperIsRef semantics: DOI exact (case/whitespace
// tolerant) OR pg_trgm title fuzzy ≥ 0.6, scoped to userId.
//
// pg_trgm-missing degrades to no-op (DOI-only path).

let hasPgTrgm = false;
let u: TestUser;
let other: TestUser;
let libraryId: number;
let otherLibraryId: number;

let paperDoiId: string;
let paperTitleId: string;
let paperOtherUserId: string;

let refDoi: string;
let refTitleOnly: string;
let refNoMatch: string;
let refCrossUser: string;

const TEST_DOI = `10.5555/identity-${Date.now()}`;
const TEST_TITLE = "Identity Match Title For Fuzzy Test";

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 'a'::text % 'a'::text`);
    hasPgTrgm = true;
  } catch {
    hasPgTrgm = false;
  }

  u = await createTestUser();
  other = await createTestUser();

  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Identity Test Library" })
    .returning({ id: libraries.id });
  libraryId = lib.id;

  const [olib] = await db
    .insert(libraries)
    .values({ userId: other.id, name: "Other Identity Library" })
    .returning({ id: libraries.id });
  otherLibraryId = olib.id;

  // Papers in userA's library:
  //   - one with matching DOI
  //   - one with matching title (no DOI)
  const papersRes = await db.execute(sql`
    INSERT INTO papers (user_id, library_id, filename, title, doi)
    VALUES
      (${u.id}, ${libraryId}, 'doi-paper.pdf', 'Some Paper', ${TEST_DOI}),
      (${u.id}, ${libraryId}, 'title-paper.pdf', ${TEST_TITLE}, NULL)
    RETURNING id
  `);
  const papersRows = (papersRes as { rows?: { id: string }[] }).rows ?? (papersRes as unknown as { id: string }[]);
  paperDoiId = papersRows[0]!.id;
  paperTitleId = papersRows[1]!.id;

  // A paper owned by another user — DOI matches userA's refDoi but must NOT
  // be returned for userA's queries (cross-user isolation).
  const otherPaperRes = await db.execute(sql`
    INSERT INTO papers (user_id, library_id, filename, title, doi)
    VALUES (${other.id}, ${otherLibraryId}, 'other.pdf', 'Other', ${TEST_DOI})
    RETURNING id
  `);
  const otherPapersRows = (otherPaperRes as { rows?: { id: string }[] }).rows ?? (otherPaperRes as unknown as { id: string }[]);
  paperOtherUserId = otherPapersRows[0]!.id;

  // References:
  const [r1] = await db
    .insert(references_)
    .values({
      libraryId,
      userId: u.id,
      citationKey: `id-doi-${Date.now()}`,
      cslJson: { DOI: TEST_DOI, title: "Some Title" },
      folderPath: "",
    })
    .returning({ id: references_.id });
  refDoi = r1.id;

  const [r2] = await db
    .insert(references_)
    .values({
      libraryId,
      userId: u.id,
      citationKey: `id-title-${Date.now()}`,
      cslJson: { title: "identity match title for fuzzy test." }, // case + punct
      folderPath: "",
    })
    .returning({ id: references_.id });
  refTitleOnly = r2.id;

  const [r3] = await db
    .insert(references_)
    .values({
      libraryId,
      userId: u.id,
      citationKey: `id-none-${Date.now()}`,
      cslJson: { title: "Completely Unrelated Subject Material" },
      folderPath: "",
    })
    .returning({ id: references_.id });
  refNoMatch = r3.id;

  const [r4] = await db
    .insert(references_)
    .values({
      libraryId: otherLibraryId,
      userId: other.id,
      citationKey: `id-cross-${Date.now()}`,
      cslJson: { DOI: TEST_DOI, title: "Other Title" },
      folderPath: "",
    })
    .returning({ id: references_.id });
  refCrossUser = r4.id;
});

afterAll(async () => {
  await db.execute(sql`
    DELETE FROM "references" WHERE id IN (${refDoi}, ${refTitleOnly}, ${refNoMatch}, ${refCrossUser})
  `);
  await db.execute(sql`
    DELETE FROM papers WHERE id IN (${paperDoiId}, ${paperTitleId}, ${paperOtherUserId})
  `);
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("findIdentityPaperForReference", () => {
  it("returns the user's paper when DOI matches", async () => {
    const hit = await findIdentityPaperForReference(refDoi, u.id);
    expect(hit?.paperId).toBe(paperDoiId);
    expect(typeof hit?.title).toBe("string");
  });

  it("returns the user's paper when title fuzzy-matches above threshold", async () => {
    if (!hasPgTrgm) {
      const hit = await findIdentityPaperForReference(refTitleOnly, u.id);
      expect(hit).toBeNull();
      return;
    }
    const hit = await findIdentityPaperForReference(refTitleOnly, u.id);
    expect(hit?.paperId).toBe(paperTitleId);
  });

  it("returns null when no DOI or title hit", async () => {
    const hit = await findIdentityPaperForReference(refNoMatch, u.id);
    expect(hit).toBeNull();
  });

  it("does NOT cross user boundaries: refDoi queried by other user returns null", async () => {
    // refDoi belongs to userA — querying with otherUser → 0 because the
    // reference row is scoped to userA.
    const hit = await findIdentityPaperForReference(refDoi, other.id);
    expect(hit).toBeNull();
  });

  it("does NOT match cross-user papers: refCrossUser resolves to other.id's own paper, never userA's same-DOI paper", async () => {
    // refCrossUser + other.id has paperOtherUserId in their library w/ same
    // DOI. The user-scoped query must return THAT paper, not userA's
    // paperDoiId which shares the DOI.
    const hit = await findIdentityPaperForReference(refCrossUser, other.id);
    expect(hit?.paperId).toBe(paperOtherUserId);
    expect(hit?.paperId).not.toBe(paperDoiId);
  });

  it("O2: explicit references_.paperId override wins over DOI derivation", async () => {
    // Override refDoi to point at the title-paper instead of the DOI-paper.
    // findIdentityPaperForReference should return paperTitleId, not paperDoiId.
    await db.execute(sql`
      UPDATE "references" SET paper_id = ${paperTitleId} WHERE id = ${refDoi}
    `);
    try {
      const hit = await findIdentityPaperForReference(refDoi, u.id);
      expect(hit?.paperId).toBe(paperTitleId);
    } finally {
      await db.execute(sql`UPDATE "references" SET paper_id = NULL WHERE id = ${refDoi}`);
    }
  });

  it("O2: stale override (paper deleted/cross-user) falls back to DOI derivation", async () => {
    // Point refDoi at a paper that's not the user's. Lookup should silently
    // fall through to DOI match so we never leak the cross-user paper.
    await db.execute(sql`
      UPDATE "references" SET paper_id = ${paperOtherUserId} WHERE id = ${refDoi}
    `);
    try {
      const hit = await findIdentityPaperForReference(refDoi, u.id);
      expect(hit?.paperId).toBe(paperDoiId);
    } finally {
      await db.execute(sql`UPDATE "references" SET paper_id = NULL WHERE id = ${refDoi}`);
    }
  });

  it("returns null for a non-existent reference id", async () => {
    const hit = await findIdentityPaperForReference(
      "00000000-0000-0000-0000-000000000000",
      u.id,
    );
    expect(hit).toBeNull();
  });
});
