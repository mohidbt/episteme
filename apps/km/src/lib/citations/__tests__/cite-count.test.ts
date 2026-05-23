import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentReferences, libraries } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";
import { getCrossLibraryCiteCounts } from "../cite-count";

// H-batch Step 7-8: cross-library cite count.
//
// For a given set of docRefIds (e.g. citations panel of paper A), compute
// the count of distinct papers in the user's library that cite the *same*
// underlying work (DOI exact / pg_trgm title fuzzy ≥ 0.6) — not just that
// specific docRef. So if paper A and paper B both have a docRef pointing at
// DOI X, the cite-count for either docRef is 2 (both A and B count as citers).
//
// pg_trgm-missing degrades to DOI-only path.

let hasPgTrgm = false;
let u: TestUser;
let other: TestUser;
let libraryId: number;
let otherLibraryId: number;

// Paper A and paper B both cite the same DOI X. The cluster across the user's
// library has 2 citers (A, B). Their docRef ids therefore both report
// citedInCount = 2 in the enrich panel after the cross-library widening.
let paperA: string;
let paperB: string;
let paperC: string; // unrelated, no citation to X
let paperOther: string; // owned by another user, MUST NOT count

let docRefA_X: number;
let docRefB_X: number;
let docRefA_Y: number; // unique DOI Y, only A cites it → count 1
let docRefOther_X: number; // other user citing DOI X

const DOI_X = `10.7777/x-${Date.now()}`;
const DOI_Y = `10.7777/y-${Date.now()}`;

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 'a'::text % 'a'::text`);
    hasPgTrgm = true;
  } catch {
    hasPgTrgm = false;
  }
  void hasPgTrgm;

  u = await createTestUser();
  other = await createTestUser();

  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Cite-count Lib" })
    .returning({ id: libraries.id });
  libraryId = lib.id;

  const [olib] = await db
    .insert(libraries)
    .values({ userId: other.id, name: "Other lib" })
    .returning({ id: libraries.id });
  otherLibraryId = olib.id;

  const papersRes = await db.execute(sql`
    INSERT INTO papers (user_id, library_id, filename, title)
    VALUES
      (${u.id}, ${libraryId}, 'a.pdf', 'Paper A'),
      (${u.id}, ${libraryId}, 'b.pdf', 'Paper B'),
      (${u.id}, ${libraryId}, 'c.pdf', 'Paper C')
    RETURNING id
  `);
  const papersRows = (papersRes as { rows?: { id: string }[] }).rows ?? (papersRes as unknown as { id: string }[]);
  paperA = papersRows[0]!.id;
  paperB = papersRows[1]!.id;
  paperC = papersRows[2]!.id;

  const otherPapersRes = await db.execute(sql`
    INSERT INTO papers (user_id, library_id, filename, title)
    VALUES (${other.id}, ${otherLibraryId}, 'other.pdf', 'Other Paper')
    RETURNING id
  `);
  const otherRows = (otherPapersRes as { rows?: { id: string }[] }).rows ?? (otherPapersRes as unknown as { id: string }[]);
  paperOther = otherRows[0]!.id;

  // document_references: A cites DOI X, B cites DOI X, A cites DOI Y, other cites DOI X
  const [a1] = await db
    .insert(documentReferences)
    .values({ paperId: paperA, markerText: "[1]", markerIndex: 1, doi: DOI_X, title: "Attention mechanisms in transformer architectures" })
    .returning({ id: documentReferences.id });
  docRefA_X = a1.id;

  const [b1] = await db
    .insert(documentReferences)
    .values({ paperId: paperB, markerText: "[1]", markerIndex: 1, doi: DOI_X, title: "Attention mechanisms in transformer architectures" })
    .returning({ id: documentReferences.id });
  docRefB_X = b1.id;

  const [a2] = await db
    .insert(documentReferences)
    .values({ paperId: paperA, markerText: "[2]", markerIndex: 2, doi: DOI_Y, title: "Quantum cryptography over noisy channels" })
    .returning({ id: documentReferences.id });
  docRefA_Y = a2.id;

  const [o1] = await db
    .insert(documentReferences)
    .values({ paperId: paperOther, markerText: "[1]", markerIndex: 1, doi: DOI_X, title: "Attention mechanisms in transformer architectures" })
    .returning({ id: documentReferences.id });
  docRefOther_X = o1.id;
});

afterAll(async () => {
  await db.execute(sql`
    DELETE FROM document_references WHERE id IN (${docRefA_X}, ${docRefB_X}, ${docRefA_Y}, ${docRefOther_X})
  `);
  await db.execute(sql`
    DELETE FROM papers WHERE id IN (${paperA}, ${paperB}, ${paperC}, ${paperOther})
  `);
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("getCrossLibraryCiteCounts", () => {
  it("returns 2 for docRefs that share DOI X with another in-library citer", async () => {
    const counts = await getCrossLibraryCiteCounts(u.id, [docRefA_X, docRefB_X]);
    expect(counts.get(docRefA_X)).toBe(2);
    expect(counts.get(docRefB_X)).toBe(2);
  });

  it("returns 1 when only one library paper cites the cluster", async () => {
    const counts = await getCrossLibraryCiteCounts(u.id, [docRefA_Y]);
    expect(counts.get(docRefA_Y)).toBe(1);
  });

  it("does NOT count cross-user citers in the cluster", async () => {
    const counts = await getCrossLibraryCiteCounts(u.id, [docRefA_X]);
    // 2, not 3: docRefOther_X belongs to other.id and must be excluded.
    expect(counts.get(docRefA_X)).toBe(2);
  });

  it("returns an empty map for empty input", async () => {
    const counts = await getCrossLibraryCiteCounts(u.id, []);
    expect(counts.size).toBe(0);
  });

  it("returns 0 / missing for unknown docRefIds", async () => {
    const counts = await getCrossLibraryCiteCounts(u.id, [999999999]);
    // Either explicitly 0 or absent — both acceptable.
    expect(counts.get(999999999) ?? 0).toBe(0);
  });
});
