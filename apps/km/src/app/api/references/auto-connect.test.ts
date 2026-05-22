import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { POST } from "./route";
import { PATCH as PATCH_ID } from "./[id]/route";
import { POST as POST_LIB } from "../libraries/route";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../_test-utils";
import { db } from "@/lib/db";
import { documentReferences, papers, paperCitations } from "@episteme/db/schema";

let u: TestUser;
let other: TestUser;
let libraryId: number;
let myPaperId: string;
let otherPaperId: string;
// Task #57 Symmetry: autoConnectReference keys citer_id by docRef int, so
// the existing "user has a paper with matching DOI" assertion now also
// requires a document_references row in the user's papers that incarnates
// the bib entry. We seed one citing paper + its docRef.
let citingPaperId: string;
let docRefId: number;

const KNOWN_DOI = "10.9999/auto-connect-test";
const OTHER_DOI = "10.9999/other-user-paper";

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "AC Lib" }) }),
  );
  libraryId = (await r.json()).id;
  const otherLibR = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: other.cookie, body: JSON.stringify({ name: "AC Other" }) }),
  );
  const otherLibId = (await otherLibR.json()).id;

  const [p1] = await db
    .insert(papers)
    .values({
      libraryId,
      userId: u.id,
      folderPath: "",
      filename: "auto-connect.pdf",
      title: "Auto Connect Target",
      doi: KNOWN_DOI,
    })
    .returning({ id: papers.id });
  myPaperId = p1.id;

  const [p2] = await db
    .insert(papers)
    .values({
      libraryId: otherLibId,
      userId: other.id,
      folderPath: "",
      filename: "other.pdf",
      title: "Other User Paper",
      doi: OTHER_DOI,
    })
    .returning({ id: papers.id });
  otherPaperId = p2.id;

  // Citing paper + docRef incarnation of the bib entry that has KNOWN_DOI.
  // Under Symmetry, autoConnectReference writes paper_citations rows keyed
  // by this docRef.id.
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

  const [dr] = await db
    .insert(documentReferences)
    .values({
      paperId: citingPaperId,
      markerText: "[1]",
      markerIndex: 1,
      doi: KNOWN_DOI,
      title: "Auto Connect Target",
    })
    .returning({ id: documentReferences.id });
  docRefId = dr.id;
});

// Tests share the single KNOWN_DOI docRef (citer_id keyspace under Symmetry),
// so clear that docRef's paper_citations rows between tests for isolation.
afterEach(async () => {
  await db
    .delete(paperCitations)
    .where(
      and(
        eq(paperCitations.citerKind, "reference"),
        eq(paperCitations.citerId, String(docRefId)),
      ),
    );
});

afterAll(async () => {
  // user/library/paper cascades drop docRef + edges via FK ON DELETE CASCADE.
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

let n = 0;
const k = (prefix: string) => `${prefix}${Date.now()}${n++}`;

// Task #57: edges are now keyed by String(docRef.id), not the references_.id
// UUID. autoConnectReference writes overwrite-style for each call (delete +
// re-insert by docRef set), so after a successful call the latest match
// method is reflected. All tests in this file share docRefId = the single
// KNOWN_DOI docRef, so we read the row for that docRef directly.
async function edgesByDocRef() {
  return db
    .select({
      id: paperCitations.id,
      citerKind: paperCitations.citerKind,
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
}

// Asserts whether an autoConnect edge currently exists pointing at the given
// cited paper from the user's KNOWN_DOI docRef. Used to disambiguate the
// "no DOI/title match" test case (where matchRefToPapers may still hit but
// we want to ensure nothing pointing at the user's paper got written for the
// caller's ref). Pre-#57 this test queried by ref.id (UUID).
async function edgeToPaper(citedPaperId: string) {
  const rows = await edgesByDocRef();
  return rows.filter((r) => r.citedId === citedPaperId);
}

describe("references POST auto-connects on DOI match", () => {
  it("creates paper_citations edge to user's paper when CSL DOI matches", async () => {
    const key = k("ac");
    const csl = {
      id: key,
      type: "article-journal",
      title: "Anything",
      DOI: KNOWN_DOI,
    };
    const r = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, citationKey: key, cslJson: csl }),
      }),
    );
    expect(r.status).toBe(201);
    const ref = await r.json();

    const edges = await edgesByDocRef();
    expect(edges.length).toBe(1);
    expect(edges[0].citedKind).toBe("paper");
    expect(edges[0].citedId).toBe(myPaperId);
    expect(edges[0].matchMethod).toBe("doi");
  });

  it("does NOT match another user's paper by DOI", async () => {
    const key = k("xu");
    const csl = {
      id: key,
      type: "article-journal",
      title: "Cross User",
      DOI: OTHER_DOI,
    };
    const r = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, citationKey: key, cslJson: csl }),
      }),
    );
    expect(r.status).toBe(201);
    // Cross-user OTHER_DOI: matchRefToPapers returns null (cross-user
    // isolation), AND there's no docRef in u's papers with OTHER_DOI, so no
    // citer_kind='reference' row should exist pointing at otherPaperId.
    const edges = await edgeToPaper(otherPaperId);
    expect(edges.length).toBe(0);
    expect(otherPaperId).toBeTruthy();
  });

  it("no edge when CSL has no DOI and no title match", async () => {
    const key = k("nd");
    const r = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          libraryId,
          citationKey: key,
          cslJson: { id: key, type: "article-journal", title: "Nothing Resembling Anything" },
        }),
      }),
    );
    expect(r.status).toBe(201);
    // No DOI and a title not matching any docRef/paper → no edges written
    // anywhere under this docRef.
    const edges = await edgesByDocRef();
    expect(edges.length).toBe(0);
  });
});

describe("references PATCH auto-connects on DOI change", () => {
  it("PATCHing in a matching DOI inserts the edge", async () => {
    const key = k("pa");
    const create = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          libraryId,
          citationKey: key,
          cslJson: { id: key, type: "article-journal", title: "x" },
        }),
      }),
    );
    const ref = await create.json();
    expect((await edgesByDocRef()).length).toBe(0);

    const newCsl = { id: key, type: "article-journal", title: "x", DOI: KNOWN_DOI };
    const patched = await PATCH_ID(
      req(`/api/references/${ref.id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ cslJson: newCsl }),
      }),
      params({ id: ref.id }),
    );
    expect(patched.status).toBe(200);

    const edges = await edgesByDocRef();
    expect(edges.length).toBe(1);
    expect(edges[0].citedId).toBe(myPaperId);
    expect(edges[0].matchMethod).toBe("doi");
  });

  it("idempotent: PATCH with same DOI doesn't duplicate edge", async () => {
    const key = k("id");
    const csl = { id: key, type: "article-journal", title: "x", DOI: KNOWN_DOI };
    const create = await POST(
      req("/api/references", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, citationKey: key, cslJson: csl }),
      }),
    );
    const ref = await create.json();
    expect((await edgesByDocRef()).length).toBe(1);

    // PATCH something benign with same DOI csl
    const patched = await PATCH_ID(
      req(`/api/references/${ref.id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ cslJson: { ...csl, title: "Y" } }),
      }),
      params({ id: ref.id }),
    );
    expect(patched.status).toBe(200);

    const edges = await edgesByDocRef();
    expect(edges.length).toBe(1);
  });
});
