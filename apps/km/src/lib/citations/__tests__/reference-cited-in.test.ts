import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentReferences, libraries, references_ } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";
import { getReferenceCitedIn } from "../reference-cited-in";

// Reflects the real D2 auto-link contract: paper_citations.cited_id (for
// cited_kind='reference') stores the **stringified document_references.id**
// (integer-as-text), NOT the references_.id UUID. Earlier impl filtered by
// the references_ UUID directly and silently returned 0 hits in production.

let hasPgTrgm = false;
let u: TestUser;
let libraryId: number;

// Common scenario rows
let refDoi: string; // references_.id with DOI
let refTitleOnly: string; // references_.id with title-only (no DOI)
let refCrossUser: string; // references_.id seeded for another user

let paperCiterDoi: string;
let paperCiterTitle: string;
let docRefDoiId: number;
let docRefTitleId: number;

// Cross-user setup
let otherUser: TestUser;
let otherLibraryId: number;
let otherPaperId: string;
let otherDocRefId: number;

const TEST_DOI = `10.1234/foo-${Date.now()}`;
const TEST_TITLE = "Attention Is All You Need In Retrieval Systems";

beforeAll(async () => {
  // Detect pg_trgm — fuzzy title test is skipped on dev DBs without it.
  // Production (Neon) has it via migration 0039; local docker-compose pg
  // image typically does not.
  try {
    await db.execute(sql`SELECT 'a'::text % 'a'::text`);
    hasPgTrgm = true;
  } catch {
    hasPgTrgm = false;
  }

  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Cited-In Test Library" })
    .returning({ id: libraries.id });
  libraryId = lib.id;

  // Citer papers for userA
  const papersResult = await db.execute(sql`
    INSERT INTO papers (user_id, library_id, filename, title)
    VALUES (${u.id}, ${libraryId}, 'doi-citer.pdf', 'Paper Citing Via DOI'),
           (${u.id}, ${libraryId}, 'title-citer.pdf', 'Paper Citing Via Title')
    RETURNING id
  `);
  const papersRows = (papersResult as { rows?: { id: string }[] }).rows ?? (papersResult as unknown as { id: string }[]);
  paperCiterDoi = papersRows[0]!.id;
  paperCiterTitle = papersRows[1]!.id;

  // References_ rows (the UUID-keyed canonical reference rows)
  const [r1] = await db
    .insert(references_)
    .values({
      libraryId,
      userId: u.id,
      citationKey: `cited-in-doi-${Date.now()}`,
      cslJson: { DOI: TEST_DOI, title: "Has DOI Ref" },
      folderPath: "",
    })
    .returning({ id: references_.id });
  refDoi = r1.id;

  const [r2] = await db
    .insert(references_)
    .values({
      libraryId,
      userId: u.id,
      citationKey: `cited-in-title-${Date.now()}`,
      cslJson: { title: TEST_TITLE },
      folderPath: "",
    })
    .returning({ id: references_.id });
  refTitleOnly = r2.id;

  // document_references that the citer papers actually attach to. cited_id in
  // paper_citations is stringified document_references.id (int).
  const [d1] = await db
    .insert(documentReferences)
    .values({
      paperId: paperCiterDoi,
      markerText: "[1]",
      markerIndex: 1,
      doi: TEST_DOI,
      title: "Has DOI Ref",
    })
    .returning({ id: documentReferences.id });
  docRefDoiId = d1.id;

  const [d2] = await db
    .insert(documentReferences)
    .values({
      paperId: paperCiterTitle,
      markerText: "[1]",
      markerIndex: 3,
      // Slight punctuation variant to exercise pg_trgm similarity > 0.6
      title: "Attention Is All You Need in Retrieval Systems.",
    })
    .returning({ id: documentReferences.id });
  docRefTitleId = d2.id;

  // The actual paper_citations rows the auto-link writer would emit:
  await db.execute(sql`
    INSERT INTO paper_citations (citer_kind, citer_id, cited_kind, cited_id, source_marker_idx, match_method)
    VALUES ('paper', ${paperCiterDoi}, 'reference', ${String(docRefDoiId)}, 1, 'doi'),
           ('paper', ${paperCiterTitle}, 'reference', ${String(docRefTitleId)}, 3, 'title-fuzzy')
  `);

  // Cross-user: another user with same DOI in a reference, citer paper, doc_ref.
  otherUser = await createTestUser();
  const [oLib] = await db
    .insert(libraries)
    .values({ userId: otherUser.id, name: "Other User Library" })
    .returning({ id: libraries.id });
  otherLibraryId = oLib.id;

  const otherPapers = await db.execute(sql`
    INSERT INTO papers (user_id, library_id, filename, title)
    VALUES (${otherUser.id}, ${otherLibraryId}, 'other.pdf', 'Other User Citer')
    RETURNING id
  `);
  const otherPapersRows = (otherPapers as { rows?: { id: string }[] }).rows ?? (otherPapers as unknown as { id: string }[]);
  otherPaperId = otherPapersRows[0]!.id;

  const [oRef] = await db
    .insert(references_)
    .values({
      libraryId: otherLibraryId,
      userId: otherUser.id,
      citationKey: `other-${Date.now()}`,
      cslJson: { DOI: TEST_DOI, title: "Has DOI Ref" },
      folderPath: "",
    })
    .returning({ id: references_.id });
  refCrossUser = oRef.id;

  const [oDoc] = await db
    .insert(documentReferences)
    .values({
      paperId: otherPaperId,
      markerText: "[1]",
      markerIndex: 1,
      doi: TEST_DOI,
      title: "Has DOI Ref",
    })
    .returning({ id: documentReferences.id });
  otherDocRefId = oDoc.id;

  await db.execute(sql`
    INSERT INTO paper_citations (citer_kind, citer_id, cited_kind, cited_id, source_marker_idx, match_method)
    VALUES ('paper', ${otherPaperId}, 'reference', ${String(otherDocRefId)}, 1, 'doi')
  `);
});

afterAll(async () => {
  await db.execute(sql`
    DELETE FROM paper_citations
    WHERE cited_id IN (${String(docRefDoiId)}, ${String(docRefTitleId)}, ${String(otherDocRefId)})
  `);
  await db.execute(sql`
    DELETE FROM document_references WHERE id IN (${docRefDoiId}, ${docRefTitleId}, ${otherDocRefId})
  `);
  await db.execute(sql`
    DELETE FROM "references" WHERE id IN (${refDoi}, ${refTitleOnly}, ${refCrossUser})
  `);
  await db.execute(sql`
    DELETE FROM papers WHERE id IN (${paperCiterDoi}, ${paperCiterTitle}, ${otherPaperId})
  `);
  await deleteTestUser(u.id);
  await deleteTestUser(otherUser.id);
});

describe("getReferenceCitedIn", () => {
  it("resolves via DOI: returns the user's papers that cite a document_reference with matching DOI", async () => {
    const rows = await getReferenceCitedIn(refDoi, u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      paperId: paperCiterDoi,
      title: "Paper Citing Via DOI",
      markerIdx: 1,
    });
  });

  it("resolves via fuzzy title: returns the user's papers that cite a document_reference with similar title", async () => {
    if (!hasPgTrgm) {
      // Local dev DB lacks pg_trgm; the production Neon DB has it via 0039.
      // Implementation graceful-degrades to no fuzzy hit — assert that path
      // instead of skipping silently.
      const rows = await getReferenceCitedIn(refTitleOnly, u.id);
      expect(rows).toHaveLength(0);
      return;
    }
    const rows = await getReferenceCitedIn(refTitleOnly, u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      paperId: paperCiterTitle,
      title: "Paper Citing Via Title",
      markerIdx: 3,
    });
  });

  it("cross-user isolation: same DOI in another user's reference returns no rows for userA's other-user query and vice-versa", async () => {
    // userA querying their own refDoi must NOT see otherUser's citer paper
    const rowsA = await getReferenceCitedIn(refDoi, u.id);
    expect(rowsA.find((r) => r.paperId === otherPaperId)).toBeUndefined();

    // otherUser querying refDoi (which belongs to userA) returns nothing —
    // references_ row is scoped to userA, so otherUser can't resolve it.
    const rowsOther = await getReferenceCitedIn(refDoi, otherUser.id);
    expect(rowsOther).toHaveLength(0);
  });
});
