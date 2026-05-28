import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { paperCitations, papers, references_ } from "@episteme/db/schema";
import { POST, DELETE } from "./route";
import { POST as POST_LIB } from "../../../libraries/route";
import { POST as POST_REF } from "../../route";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../../../_test-utils";

// O2: manual paper attach + disconnect endpoints. Restores the UX deleted in
// b8b7556. Manual edges are citerId=refId(UUID), matchMethod='manual' — kept
// semantically distinct from bibliography citation edges (citerId=docRefId).

let u: TestUser;
let other: TestUser;
let libraryId: number;
let otherLibraryId: number;
let myPaperId: string;
let otherPaperId: string;
let keyCounter = 0;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Attach Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
  const r2 = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: other.cookie,
      body: JSON.stringify({ name: "Attach Other Lib" }),
    }),
  );
  otherLibraryId = (await r2.json()).id;

  const [p1] = await db
    .insert(papers)
    .values({
      libraryId,
      userId: u.id,
      folderPath: "",
      filename: "attach.pdf",
      title: "Attach Target",
    })
    .returning({ id: papers.id });
  myPaperId = p1.id;

  const [p2] = await db
    .insert(papers)
    .values({
      libraryId: otherLibraryId,
      userId: other.id,
      folderPath: "",
      filename: "other.pdf",
      title: "Other User Paper",
    })
    .returning({ id: papers.id });
  otherPaperId = p2.id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

function uniqueKey(): string {
  return `attach${Date.now()}${keyCounter++}`;
}

async function createRef(): Promise<string> {
  const r = await POST_REF(
    req("/api/references", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        libraryId,
        citationKey: uniqueKey(),
        cslJson: { type: "article-journal", title: "Manual Attach Ref" },
      }),
    }),
  );
  if (r.status !== 201) throw new Error(`create ref failed: ${r.status}`);
  return (await r.json()).id as string;
}

describe("POST /api/references/:id/attach-paper", () => {
  it("attaches a paper: sets references_.paperId and writes a manual edge", async () => {
    const refId = await createRef();
    const r = await POST(
      req(`/api/references/${refId}/attach-paper`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperId: myPaperId }),
      }),
      params({ id: refId }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.paperId).toBe(myPaperId);

    const [row] = await db
      .select({ paperId: references_.paperId })
      .from(references_)
      .where(eq(references_.id, refId));
    expect(row?.paperId).toBe(myPaperId);

    const edges = await db
      .select()
      .from(paperCitations)
      .where(
        and(
          eq(paperCitations.citerKind, "reference"),
          eq(paperCitations.citerId, refId),
          eq(paperCitations.citedKind, "paper"),
          eq(paperCitations.citedId, myPaperId),
        ),
      );
    expect(edges).toHaveLength(1);
    expect(edges[0].matchMethod).toBe("manual");
  });

  it("400 when paperId missing", async () => {
    const refId = await createRef();
    const r = await POST(
      req(`/api/references/${refId}/attach-paper`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({}),
      }),
      params({ id: refId }),
    );
    expect(r.status).toBe(400);
  });

  it("404 when reference belongs to a different user", async () => {
    const refId = await createRef();
    const r = await POST(
      req(`/api/references/${refId}/attach-paper`, {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({ paperId: otherPaperId }),
      }),
      params({ id: refId }),
    );
    expect(r.status).toBe(404);
  });

  it("403 when the paper belongs to another user", async () => {
    const refId = await createRef();
    const r = await POST(
      req(`/api/references/${refId}/attach-paper`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperId: otherPaperId }),
      }),
      params({ id: refId }),
    );
    expect(r.status).toBe(403);
  });
});

describe("DELETE /api/references/:id/attach-paper", () => {
  it("detaches: clears references_.paperId and removes manual edge ONLY", async () => {
    const refId = await createRef();

    // Attach first.
    await POST(
      req(`/api/references/${refId}/attach-paper`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperId: myPaperId }),
      }),
      params({ id: refId }),
    );

    // Seed a bibliography-style edge (citer_id is a doc-ref id stringified —
    // we use a synthetic int-as-text to simulate the docRef-keyed edge).
    // Disconnect MUST NOT remove this edge.
    await db.insert(paperCitations).values({
      citerKind: "reference",
      citerId: "999999",
      citedKind: "paper",
      citedId: myPaperId,
      sourceMarkerIdx: null,
      matchMethod: "doi",
    });

    const r = await DELETE(
      req(`/api/references/${refId}/attach-paper`, {
        method: "DELETE",
        cookie: u.cookie,
      }),
      params({ id: refId }),
    );
    expect(r.status).toBe(204);

    const [row] = await db
      .select({ paperId: references_.paperId })
      .from(references_)
      .where(eq(references_.id, refId));
    expect(row?.paperId).toBeNull();

    // Manual edge is gone.
    const manualEdges = await db
      .select()
      .from(paperCitations)
      .where(
        and(
          eq(paperCitations.citerKind, "reference"),
          eq(paperCitations.citerId, refId),
        ),
      );
    expect(manualEdges).toHaveLength(0);

    // Bibliography (non-manual) edge survives.
    const bibEdges = await db
      .select()
      .from(paperCitations)
      .where(
        and(
          eq(paperCitations.citerKind, "reference"),
          eq(paperCitations.citerId, "999999"),
          eq(paperCitations.citedKind, "paper"),
          eq(paperCitations.citedId, myPaperId),
        ),
      );
    expect(bibEdges).toHaveLength(1);
    expect(bibEdges[0].matchMethod).toBe("doi");

    // Cleanup the seeded bib edge.
    await db
      .delete(paperCitations)
      .where(
        and(
          eq(paperCitations.citerKind, "reference"),
          eq(paperCitations.citerId, "999999"),
        ),
      );
  });

  it("404 when reference belongs to another user", async () => {
    const refId = await createRef();
    const r = await DELETE(
      req(`/api/references/${refId}/attach-paper`, {
        method: "DELETE",
        cookie: other.cookie,
      }),
      params({ id: refId }),
    );
    expect(r.status).toBe(404);
  });
});
