// -----------------------------------------------------------------------------
// Edge-case enumeration (per plan §12) for GET /api/papers/:id/ingest-status
// -----------------------------------------------------------------------------
// applicable + tested:
//   - auth-fail:      "401 when unauthenticated"
//   - null:           "200 with chunksReadyAt=null pre-ingest" (pre-stamp state)
//   - golden path:    "200 with chunksReadyAt timestamp once stamped"
//   - partial-failure (cross-owner leak): "404 when other user owns the paper"
//   - empty / not-found: "404 on missing paper"
// applicable but omitted (justified):
//   - max-size:       N/A — endpoint has no request body, only a UUID param.
//   - unicode/emoji:  N/A — UUID param is RFC-4122 hex only.
//   - concurrent:     read-only GET; idempotent by definition. Race on the
//                     UPDATE happens in agents-side embed-chunks, covered
//                     there by ON CONFLICT + transaction wrap.
//   - idempotency:    same as concurrent — GET is naturally idempotent.
//   - retry:          standard HTTP retry semantics; no special handling.
// -----------------------------------------------------------------------------
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET } from "./route";
import { POST as POST_PAPER } from "../../route";
import { POST as POST_LIB } from "../../../libraries/route";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../../../_test-utils";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";

let u: TestUser;
let other: TestUser;
let libraryId: number;
const createdPaperIds: string[] = [];

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Ingest Status Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
}, 30_000);

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

async function initPaper(): Promise<string> {
  const r = await POST_PAPER(
    req("/api/papers", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        libraryId,
        filename: "a.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
      }),
    }),
  );
  if (r.status !== 201) throw new Error(`init paper failed: ${r.status}`);
  const body = await r.json();
  createdPaperIds.push(body.paperId);
  return body.paperId;
}

const MISSING_ID = "00000000-0000-0000-0000-000000000000";

describe("GET /api/papers/:id/ingest-status — GSD-96 R1", () => {
  it("401 when unauthenticated", async () => {
    const r = await GET(
      req(`/api/papers/${MISSING_ID}/ingest-status`),
      params({ id: MISSING_ID }),
    );
    expect(r.status).toBe(401);
  });

  it("404 on missing paper", async () => {
    const r = await GET(
      req(`/api/papers/${MISSING_ID}/ingest-status`, { cookie: u.cookie }),
      params({ id: MISSING_ID }),
    );
    expect(r.status).toBe(404);
  });

  it("404 when other user owns the paper (no leak)", async () => {
    const paperId = await initPaper();
    const r = await GET(
      req(`/api/papers/${paperId}/ingest-status`, { cookie: other.cookie }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(404);
  });

  it("200 with chunksReadyAt=null pre-ingest", async () => {
    const paperId = await initPaper();
    const r = await GET(
      req(`/api/papers/${paperId}/ingest-status`, { cookie: u.cookie }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.chunksReadyAt).toBeNull();
    expect(typeof body.chandraStatus).toBe("string");
  });

  it("200 with chunksReadyAt timestamp once stamped", async () => {
    const paperId = await initPaper();
    const stamp = new Date();
    await db.update(papers).set({ chunksReadyAt: stamp }).where(eq(papers.id, paperId));
    const r = await GET(
      req(`/api/papers/${paperId}/ingest-status`, { cookie: u.cookie }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.chunksReadyAt).not.toBeNull();
    expect(new Date(body.chunksReadyAt).getTime()).toBeCloseTo(stamp.getTime(), -2);
  });
});
