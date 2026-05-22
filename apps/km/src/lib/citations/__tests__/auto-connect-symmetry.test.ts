import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documentReferences,
  libraries,
  paperCitations,
  papers,
  references_,
} from "@episteme/db/schema";
import {
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "@/app/api/_test-utils";
import {
  autoConnectReference,
  extractRefSignals,
} from "@/lib/citations/match-ref-to-papers";
import { enrichRefsWithPaperMatchAndEdges } from "@/lib/citations/enrich-refs";

// Task #57: autoConnectReference previously wrote citer_id = references_.id
// (UUID). All readers of citer_kind='reference' (enrich-refs.ts citingCount,
// reference-edges.ts) expect citer_id = String(documentReferences.id) (int as
// text) — symmetric with auto-link.ts's cited-side convention. The UUID rows
// were silently invisible to every reader.
//
// These tests pin the Symmetry contract: autoConnectReference should look up
// document_references rows in the user's papers that match the library
// reference's DOI/title, and emit one row per match keyed by the docRef int.

let u: TestUser;
let libraryId: number;
let citingPaperId: string;
let targetPaperId: string;
let docRefId: number;
let refLibraryId: string;

const KNOWN_DOI = `10.9999/symmetry-${Date.now()}`;

beforeAll(async () => {
  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Symmetry Lib" })
    .returning({ id: libraries.id });
  libraryId = lib.id;

  // Target paper — the library reference's DOI matches this one. Library
  // reference's intent: "I (the ref) cite this paper."
  const [pT] = await db
    .insert(papers)
    .values({
      libraryId,
      userId: u.id,
      folderPath: "",
      filename: "target.pdf",
      title: "Target Paper",
      doi: KNOWN_DOI,
    })
    .returning({ id: papers.id });
  targetPaperId = pT.id;

  // A paper in the user's library whose extracted bibliography contains the
  // SAME DOI — this is the document_references "incarnation" of the library
  // reference. Under Symmetry, this docRef's id becomes the citer_id.
  const [pC] = await db
    .insert(papers)
    .values({
      libraryId,
      userId: u.id,
      folderPath: "",
      filename: "citing.pdf",
      title: "Citing Paper",
    })
    .returning({ id: papers.id });
  citingPaperId = pC.id;

  const [docRef] = await db
    .insert(documentReferences)
    .values({
      paperId: citingPaperId,
      markerText: "[1]",
      markerIndex: 1,
      doi: KNOWN_DOI,
      title: "Target Paper",
    })
    .returning({ id: documentReferences.id });
  docRefId = docRef.id;

  // The library reference itself (UUID-keyed).
  const [r] = await db
    .insert(references_)
    .values({
      libraryId,
      userId: u.id,
      citationKey: `sym-${Date.now()}`,
      cslJson: { DOI: KNOWN_DOI, title: "Target Paper" },
      folderPath: "",
    })
    .returning({ id: references_.id });
  refLibraryId = r.id;
});

afterAll(async () => {
  await db
    .delete(paperCitations)
    .where(
      and(
        eq(paperCitations.citerKind, "reference"),
        inArray(paperCitations.citerId, [String(docRefId), refLibraryId]),
      ),
    );
  await db.execute(sql`DELETE FROM document_references WHERE id = ${docRefId}`);
  await db.execute(sql`DELETE FROM "references" WHERE id = ${refLibraryId}`);
  await db.execute(
    sql`DELETE FROM papers WHERE id IN (${citingPaperId}, ${targetPaperId})`,
  );
  await deleteTestUser(u.id);
});

describe("autoConnectReference — Symmetry (#57)", () => {
  it("writes citer_id = String(documentReferences.id), NOT the references_ UUID", async () => {
    const signals = extractRefSignals({ DOI: KNOWN_DOI, title: "Target Paper" });
    const result = await autoConnectReference(refLibraryId, u.id, signals);
    expect(result?.paperId).toBe(targetPaperId);
    expect(result?.matchMethod).toBe("doi");

    // No UUID-keyed leftover.
    const uuidRows = await db
      .select({ id: paperCitations.id })
      .from(paperCitations)
      .where(
        and(
          eq(paperCitations.citerKind, "reference"),
          eq(paperCitations.citerId, refLibraryId),
        ),
      );
    expect(uuidRows).toHaveLength(0);

    // Exactly one int-keyed row, citer_id = String(docRefId).
    const intRows = await db
      .select({
        citerId: paperCitations.citerId,
        citedKind: paperCitations.citedKind,
        citedId: paperCitations.citedId,
        matchMethod: paperCitations.matchMethod,
      })
      .from(paperCitations)
      .where(
        and(
          eq(paperCitations.citerKind, "reference"),
          eq(paperCitations.citerId, String(docRefId)),
        ),
      );
    expect(intRows).toHaveLength(1);
    expect(intRows[0]).toMatchObject({
      citedKind: "paper",
      citedId: targetPaperId,
      matchMethod: "doi",
    });
  });

  it("enrich-refs surfaces the autoConnect edge as citingCount=1 for this docRef", async () => {
    // Idempotent re-run: previous test already wrote the edge.
    const enriched = await enrichRefsWithPaperMatchAndEdges(
      [{ id: docRefId, doi: KNOWN_DOI }],
      u.id,
    );
    expect(enriched).toHaveLength(1);
    expect(enriched[0].citingCount).toBe(1);
  });

  it("no docRef match in user's papers → no edge written (defer until extraction)", async () => {
    // Brand-new library reference with a DOI no docRef in the user's papers
    // matches. matchRefToPapers may still match a target paper, but with no
    // doc-ref incarnation we have no int-keyed citer to write under Symmetry.
    const orphanDoi = `10.9999/orphan-${Date.now()}`;
    const [orphanTarget] = await db
      .insert(papers)
      .values({
        libraryId,
        userId: u.id,
        folderPath: "",
        filename: "orphan.pdf",
        title: "Orphan Target",
        doi: orphanDoi,
      })
      .returning({ id: papers.id });

    const [orphanRef] = await db
      .insert(references_)
      .values({
        libraryId,
        userId: u.id,
        citationKey: `orphan-${Date.now()}`,
        cslJson: { DOI: orphanDoi, title: "Orphan Target" },
        folderPath: "",
      })
      .returning({ id: references_.id });

    try {
      await autoConnectReference(
        orphanRef.id,
        u.id,
        extractRefSignals({ DOI: orphanDoi, title: "Orphan Target" }),
      );

      // No row written (citer_kind='reference', any citer_id) because no
      // docRef "incarnation" exists for orphanRef yet.
      const rows = await db
        .select({ id: paperCitations.id })
        .from(paperCitations)
        .where(
          and(
            eq(paperCitations.citerKind, "reference"),
            eq(paperCitations.citedKind, "paper"),
            eq(paperCitations.citedId, orphanTarget.id),
          ),
        );
      expect(rows).toHaveLength(0);
    } finally {
      await db.execute(sql`DELETE FROM "references" WHERE id = ${orphanRef.id}`);
      await db.execute(sql`DELETE FROM papers WHERE id = ${orphanTarget.id}`);
    }
  });
});
