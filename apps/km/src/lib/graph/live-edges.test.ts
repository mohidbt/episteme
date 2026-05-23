import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@episteme/db/client";
import { sql } from "drizzle-orm";
import {
  seedGraphFixture,
  seedPaperCitationsFixture,
  SEED_USER,
  SEED_OTHER_USER,
  SEED_IDS,
} from "../../../../../packages/db/__tests__/fixtures/graph-seed";
import {
  edgesPaperIsRef,
  edgesWikiLink,
  edgesSharedTag,
  edgesSemanticSim,
  edgesPaperCitations,
  nodesForUser,
} from "./live-edges";

// Extra identity-edge fixture nodes for H-batch tests. Distinct UUIDs from
// SEED_IDS so the existing seedGraphFixture remains untouched.
const ID = {
  // paper + reference paired by DOI
  pDoi: "aaaaaaa1-0000-0000-0000-000000000001",
  rDoi: "aaaaaaa1-0000-0000-0000-000000000002",
  // paper + reference paired by fuzzy title only (no DOI on either)
  pFuzzy: "aaaaaaa2-0000-0000-0000-000000000001",
  rFuzzy: "aaaaaaa2-0000-0000-0000-000000000002",
  // reference with stale paper_id pointing at a paper that does NOT match
  // by DOI or title — must NOT emit an identity edge.
  pStale: "aaaaaaa3-0000-0000-0000-000000000001",
  rStaleRef: "aaaaaaa3-0000-0000-0000-000000000002",
  // cross-user pair (must not leak)
  pOtherLeak: "aaaaaaa4-0000-0000-0000-000000000001",
  rOtherLeak: "aaaaaaa4-0000-0000-0000-000000000002",
  // widened citation fixture: paper_citations row pointing at a document
  // reference whose DOI matches a library reference.
  pCiter: "aaaaaaa5-0000-0000-0000-000000000001",
  rLibCited: "aaaaaaa5-0000-0000-0000-000000000003",
  // orphan: paper_citations row pointing at a document reference with no
  // matching library reference — must NOT emit a citation edge.
  pOrphanCiter: "aaaaaaa6-0000-0000-0000-000000000001",
  // docRef→paper widened path (Step 9 gap fix): paper A cites docRef X via
  // DOI; paper B exists in user's library with matching DOI; expect citing
  // edge A→B (paper-node) + cited_in B→A.
  pCiterPaperOnly: "aaaaaaa7-0000-0000-0000-000000000001",
  pCitedPaperOnly: "aaaaaaa7-0000-0000-0000-000000000002",
  // docRef matches BOTH a library ref AND a different paper by DOI; expect
  // TWO citing edges from the citer (one to ref, one to paper).
  pCiterBoth: "aaaaaaa8-0000-0000-0000-000000000001",
  pCitedBoth: "aaaaaaa8-0000-0000-0000-000000000002",
  rCitedBoth: "aaaaaaa8-0000-0000-0000-000000000003",
};

function firstId(res: unknown): number | undefined {
  const a = res as { rows?: Array<{ id: number }> };
  if (a.rows && a.rows[0]) return a.rows[0].id;
  if (Array.isArray(res) && (res as Array<{ id: number }>)[0]) return (res as Array<{ id: number }>)[0].id;
  return undefined;
}

async function seedIdentityFixture(): Promise<void> {
  const libRes = await db.execute(sql`SELECT id FROM libraries WHERE user_id = ${SEED_USER} LIMIT 1`);
  const libId = firstId(libRes);
  const otherLibRes = await db.execute(sql`SELECT id FROM libraries WHERE user_id = ${SEED_OTHER_USER} LIMIT 1`);
  const otherLibId = firstId(otherLibRes);

  // DOI-match pair.
  await db.execute(sql`
    INSERT INTO papers (id, user_id, library_id, filename, title, doi)
    VALUES (${ID.pDoi}, ${SEED_USER}, ${libId}, 'pdoi.pdf', 'DOI Paper', '10.1000/identity.doi')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO "references" (id, library_id, user_id, citation_key, csl_json)
    VALUES (${ID.rDoi}, ${libId}, ${SEED_USER}, 'kdoi',
            '{"DOI":"  10.1000/IDENTITY.DOI ","title":"Something Else"}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);

  // Fuzzy-title-only pair (no DOIs).
  await db.execute(sql`
    INSERT INTO papers (id, user_id, library_id, filename, title)
    VALUES (${ID.pFuzzy}, ${SEED_USER}, ${libId}, 'pfuzzy.pdf',
            'Propensity Score Matching for Causal Inference in Practice')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO "references" (id, library_id, user_id, citation_key, csl_json)
    VALUES (${ID.rFuzzy}, ${libId}, ${SEED_USER}, 'kfuzzy',
            '{"title":"Propensity Score Matching for Causal Inference in Practice."}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);

  // Stale paper_id: refStaleRef.paper_id → pStale but neither DOI nor title
  // align (no DOIs anywhere; titles totally distinct).
  await db.execute(sql`
    INSERT INTO papers (id, user_id, library_id, filename, title)
    VALUES (${ID.pStale}, ${SEED_USER}, ${libId}, 'pstale.pdf', 'AAAAAA — totally distinct paper title for stale check')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO "references" (id, library_id, user_id, citation_key, csl_json, paper_id)
    VALUES (${ID.rStaleRef}, ${libId}, ${SEED_USER}, 'kstale',
            '{"title":"ZZZZZZ — quite unrelated stale reference title"}'::jsonb,
            ${ID.pStale})
    ON CONFLICT (id) DO NOTHING
  `);

  // Cross-user leak: paper in user A, reference in user OTHER with same DOI.
  if (otherLibId) {
    await db.execute(sql`
      INSERT INTO papers (id, user_id, library_id, filename, title, doi)
      VALUES (${ID.pOtherLeak}, ${SEED_USER}, ${libId}, 'pleak.pdf', 'Leak Paper', '10.1000/leak.doi')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO "references" (id, library_id, user_id, citation_key, csl_json)
      VALUES (${ID.rOtherLeak}, ${otherLibId}, ${SEED_OTHER_USER}, 'kleak',
              '{"DOI":"10.1000/leak.doi","title":"Leak Ref"}'::jsonb)
      ON CONFLICT (id) DO NOTHING
    `);
  }

  // Widened citation fixture: pCiter has a document_references row tagged
  // with the DOI of an existing library reference (rLibCited). A
  // paper_citations row points paper → that document_references id.
  await db.execute(sql`
    INSERT INTO papers (id, user_id, library_id, filename, title)
    VALUES (${ID.pCiter}, ${SEED_USER}, ${libId}, 'pciter.pdf', 'Citer Paper')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO "references" (id, library_id, user_id, citation_key, csl_json)
    VALUES (${ID.rLibCited}, ${libId}, ${SEED_USER}, 'klibcited',
            '{"DOI":"10.1000/widened.cite","title":"Widened Library Ref"}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);
  // Clear any prior dr/pc rows for this fixture so re-runs stay clean.
  await db.execute(sql`
    DELETE FROM paper_citations
    WHERE citer_id IN (${ID.pCiter}, ${ID.pOrphanCiter}, ${ID.pCiterPaperOnly}, ${ID.pCiterBoth})
  `);
  await db.execute(sql`
    DELETE FROM document_references
    WHERE paper_id IN (${ID.pCiter}, ${ID.pOrphanCiter}, ${ID.pCiterPaperOnly}, ${ID.pCiterBoth})
  `);
  const drIns = await db.execute(sql`
    INSERT INTO document_references (paper_id, marker_text, marker_index, doi, title)
    VALUES (${ID.pCiter}, '[1]', 1, '10.1000/widened.cite', 'Widened Library Ref')
    RETURNING id
  `);
  const drId = firstId(drIns);
  await db.execute(sql`
    INSERT INTO paper_citations (citer_kind, citer_id, cited_kind, cited_id, match_method)
    VALUES ('paper', ${ID.pCiter}, 'reference', ${String(drId)}, 'doi')
    ON CONFLICT DO NOTHING
  `);

  // Orphan: docRef with DOI that does NOT match any library reference.
  await db.execute(sql`
    INSERT INTO papers (id, user_id, library_id, filename, title)
    VALUES (${ID.pOrphanCiter}, ${SEED_USER}, ${libId}, 'porphan.pdf', 'Orphan Citer')
    ON CONFLICT (id) DO NOTHING
  `);
  const drOrphan = await db.execute(sql`
    INSERT INTO document_references (paper_id, marker_text, marker_index, doi, title)
    VALUES (${ID.pOrphanCiter}, '[1]', 1, '10.9999/no.such.library.ref', 'Truly Orphan Reference')
    RETURNING id
  `);
  const drOrphanId = firstId(drOrphan);
  await db.execute(sql`
    INSERT INTO paper_citations (citer_kind, citer_id, cited_kind, cited_id, match_method)
    VALUES ('paper', ${ID.pOrphanCiter}, 'reference', ${String(drOrphanId)}, 'manual')
    ON CONFLICT DO NOTHING
  `);

  // docRef→paper-only widened path: pCiterPaperOnly cites a docRef whose
  // DOI matches pCitedPaperOnly. No library reference exists for that DOI.
  await db.execute(sql`
    INSERT INTO papers (id, user_id, library_id, filename, title, doi)
    VALUES
      (${ID.pCiterPaperOnly}, ${SEED_USER}, ${libId}, 'pcite-po.pdf', 'Citer Paper Only', NULL),
      (${ID.pCitedPaperOnly}, ${SEED_USER}, ${libId}, 'pcited-po.pdf', 'Cited Paper Only', '10.1000/paper-only.cite')
    ON CONFLICT (id) DO NOTHING
  `);
  const drPaperOnly = await db.execute(sql`
    INSERT INTO document_references (paper_id, marker_text, marker_index, doi, title)
    VALUES (${ID.pCiterPaperOnly}, '[1]', 1, '10.1000/paper-only.cite', 'Paper Only Cite')
    RETURNING id
  `);
  const drPaperOnlyId = firstId(drPaperOnly);
  await db.execute(sql`
    INSERT INTO paper_citations (citer_kind, citer_id, cited_kind, cited_id, match_method)
    VALUES ('paper', ${ID.pCiterPaperOnly}, 'reference', ${String(drPaperOnlyId)}, 'doi')
    ON CONFLICT DO NOTHING
  `);

  // docRef matches BOTH a library reference AND a different paper by DOI.
  // Expect both ref-node citing edge AND paper-node citing edge from pCiterBoth.
  await db.execute(sql`
    INSERT INTO papers (id, user_id, library_id, filename, title, doi)
    VALUES
      (${ID.pCiterBoth}, ${SEED_USER}, ${libId}, 'pciter-both.pdf', 'Citer Both', NULL),
      (${ID.pCitedBoth}, ${SEED_USER}, ${libId}, 'pcited-both.pdf', 'Cited Both', '10.1000/both.cite')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO "references" (id, library_id, user_id, citation_key, csl_json)
    VALUES (${ID.rCitedBoth}, ${libId}, ${SEED_USER}, 'kboth',
            '{"DOI":"10.1000/both.cite","title":"Both Library Ref"}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);
  const drBoth = await db.execute(sql`
    INSERT INTO document_references (paper_id, marker_text, marker_index, doi, title)
    VALUES (${ID.pCiterBoth}, '[1]', 1, '10.1000/both.cite', 'Both Cite')
    RETURNING id
  `);
  const drBothId = firstId(drBoth);
  await db.execute(sql`
    INSERT INTO paper_citations (citer_kind, citer_id, cited_kind, cited_id, match_method)
    VALUES ('paper', ${ID.pCiterBoth}, 'reference', ${String(drBothId)}, 'doi')
    ON CONFLICT DO NOTHING
  `);
}

beforeAll(async () => {
  await seedGraphFixture();
  await seedPaperCitationsFixture();
  await seedIdentityFixture();
});

describe("live-edges", () => {
  it("paper_is_ref: emits identity edge by DOI match (case + whitespace insensitive)", async () => {
    const r = await edgesPaperIsRef(SEED_USER);
    const doiEdge = r.find(
      (e) => e.src.id === ID.pDoi && e.dst.id === ID.rDoi,
    );
    expect(doiEdge).toBeDefined();
    expect(doiEdge!.kind).toBe("paper_is_ref");
    expect(doiEdge!.src.kind).toBe("paper");
    expect(doiEdge!.dst.kind).toBe("reference");
  });

  it("paper_is_ref: emits identity edge by pg_trgm fuzzy title match", async () => {
    const r = await edgesPaperIsRef(SEED_USER);
    const fuzzy = r.find(
      (e) => e.src.id === ID.pFuzzy && e.dst.id === ID.rFuzzy,
    );
    expect(fuzzy).toBeDefined();
    expect(fuzzy!.kind).toBe("paper_is_ref");
  });

  it("paper_is_ref: IGNORES references.paper_id (legacy field is no longer load-bearing)", async () => {
    const r = await edgesPaperIsRef(SEED_USER);
    // rStaleRef.paper_id = pStale but no DOI/title overlap → must NOT emit.
    const stale = r.find(
      (e) => e.src.id === ID.pStale && e.dst.id === ID.rStaleRef,
    );
    expect(stale).toBeUndefined();
    // Also: legacy r1 (seedGraphFixture) had paper_id=p2 and no DOI/title
    // match. The old impl emitted it; the new impl must not.
    const legacy = r.find(
      (e) => e.src.id === SEED_IDS.p2 && e.dst.id === SEED_IDS.r1,
    );
    expect(legacy).toBeUndefined();
  });

  it("paper_is_ref: userId-scoped (no cross-user leak via DOI match)", async () => {
    const r = await edgesPaperIsRef(SEED_USER);
    // pOtherLeak (user=SEED_USER) and rOtherLeak (user=SEED_OTHER_USER) share
    // the same DOI; cross-user join must not emit.
    const leak = r.find(
      (e) => e.dst.id === ID.rOtherLeak || e.src.id === ID.pOtherLeak,
    );
    expect(leak).toBeUndefined();
  });
  it("wiki_link returns n1->p1 and n1->r1", async () => {
    const r = await edgesWikiLink(SEED_USER);
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.some((e) => e.dst.kind === "paper")).toBe(true);
    expect(r.some((e) => e.dst.kind === "reference")).toBe(true);
  });
  it("shared_tag note↔note", async () => {
    const r = await edgesSharedTag(SEED_USER);
    expect(r.some((e) => e.src.kind === "note" && e.dst.kind === "note")).toBe(true);
  });
  it("nodesForUser returns 3 kinds", async () => {
    const ns = await nodesForUser(SEED_USER);
    const kinds = new Set(ns.map((n) => n.kind));
    expect(kinds.has("paper") && kinds.has("note") && kinds.has("reference")).toBe(true);
  });
  it("paper_citations: emits ONE citing edge per paper↔paper row (no reciprocal)", async () => {
    const r = await edgesPaperCitations(SEED_USER);
    // paper↔paper edges between p1 and p2: exactly one row in the seed.
    const ppCiting = r.filter(
      (e) =>
        e.kind === "citing" &&
        e.src.kind === "paper" &&
        e.src.id === SEED_IDS.p1 &&
        e.dst.kind === "paper" &&
        e.dst.id === SEED_IDS.p2,
    );
    expect(ppCiting).toHaveLength(1);

    // No reciprocal edge from p2→p1 for the same row.
    const reciprocal = r.find(
      (e) =>
        e.src.kind === "paper" &&
        e.src.id === SEED_IDS.p2 &&
        e.dst.kind === "paper" &&
        e.dst.id === SEED_IDS.p1,
    );
    expect(reciprocal).toBeUndefined();

    // cross-user paper edge not present
    expect(r.some((x) => x.dst.id === SEED_IDS.pOther || x.src.id === SEED_IDS.pOther)).toBe(false);
  });

  it("paper_citations: widened path emits ONE citing edge for paper→docRef→libraryRef match", async () => {
    const r = await edgesPaperCitations(SEED_USER);
    const citing = r.filter(
      (e) =>
        e.kind === "citing" &&
        e.src.kind === "paper" &&
        e.src.id === ID.pCiter &&
        e.dst.kind === "reference" &&
        e.dst.id === ID.rLibCited,
    );
    expect(citing).toHaveLength(1);
    // no reciprocal
    const reciprocal = r.find(
      (e) => e.src.id === ID.rLibCited && e.dst.id === ID.pCiter,
    );
    expect(reciprocal).toBeUndefined();
  });

  it("paper_citations: widened path emits ONE paper-node citing edge when docRef→paper matches (no library ref needed)", async () => {
    const r = await edgesPaperCitations(SEED_USER);
    const citing = r.filter(
      (e) =>
        e.kind === "citing" &&
        e.src.kind === "paper" &&
        e.src.id === ID.pCiterPaperOnly &&
        e.dst.kind === "paper" &&
        e.dst.id === ID.pCitedPaperOnly,
    );
    expect(citing).toHaveLength(1);
    const reciprocal = r.find(
      (e) =>
        e.src.id === ID.pCitedPaperOnly && e.dst.id === ID.pCiterPaperOnly,
    );
    expect(reciprocal).toBeUndefined();
  });

  it("paper_citations: widened path emits BOTH ref-node and paper-node citing edges when docRef matches both", async () => {
    const r = await edgesPaperCitations(SEED_USER);
    const citingRef = r.find(
      (e) =>
        e.kind === "citing" &&
        e.src.id === ID.pCiterBoth &&
        e.dst.kind === "reference" &&
        e.dst.id === ID.rCitedBoth,
    );
    const citingPaper = r.find(
      (e) =>
        e.kind === "citing" &&
        e.src.id === ID.pCiterBoth &&
        e.dst.kind === "paper" &&
        e.dst.id === ID.pCitedBoth,
    );
    expect(citingRef).toBeDefined();
    expect(citingPaper).toBeDefined();
  });

  it("paper_citations: skips widened path when docRef has no matching library reference (orphan)", async () => {
    const r = await edgesPaperCitations(SEED_USER);
    // pOrphanCiter has a paper_citations row pointing at a docRef with a
    // DOI/title that does NOT match any library reference — must NOT emit.
    const orphan = r.find((e) => e.src.id === ID.pOrphanCiter || e.dst.id === ID.pOrphanCiter);
    expect(orphan).toBeUndefined();
  });

  it("edgesSemanticSim returns empty array on empty table", async () => {
    const r = await edgesSemanticSim(SEED_USER);
    expect(Array.isArray(r)).toBe(true);
    // demo cut: semantic_edges is empty in production; helper still must not throw
  });
});
