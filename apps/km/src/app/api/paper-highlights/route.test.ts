import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { DELETE as DEL_ID } from "./[id]/route";
import { POST as POST_LIB } from "../libraries/route";
import { POST as POST_PAPER } from "../papers/route";
import { DELETE as DEL_PAPER } from "../papers/[id]/route";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../_test-utils";
import { ensureMinIOReady } from "../_minio-setup";
import { storage, paperSourceKey, paperCoverKey } from "@/lib/storage";

let u: TestUser;
let other: TestUser;
let libraryId: number;
let otherLibraryId: number;
let paperId: string;
let otherPaperId: string;
const createdPaperIds: string[] = [];

async function createPaper(cookie: string, libId: number, filename = "hl.pdf") {
  const r = await POST_PAPER(
    req("/api/papers", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        libraryId: libId,
        filename,
        contentType: "application/pdf",
        sizeBytes: 1024,
      }),
    }),
  );
  const body = await r.json();
  createdPaperIds.push(body.paperId);
  return body.paperId as string;
}

beforeAll(async () => {
  await ensureMinIOReady();
  u = await createTestUser();
  other = await createTestUser();

  const lib = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "HL Lib" }) }),
  );
  libraryId = (await lib.json()).id;

  const otherLib = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: other.cookie, body: JSON.stringify({ name: "HL Other Lib" }) }),
  );
  otherLibraryId = (await otherLib.json()).id;

  paperId = await createPaper(u.cookie, libraryId);
  otherPaperId = await createPaper(other.cookie, otherLibraryId, "other.pdf");
}, 60_000);

afterAll(async () => {
  for (const pid of createdPaperIds) {
    await storage.deleteObject(paperSourceKey(pid)).catch(() => {});
    await storage.deleteObject(paperCoverKey(pid)).catch(() => {});
  }
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("paper-highlights", () => {
  it("POST 401 no user", async () => {
    const r = await POST(
      req("/api/paper-highlights", {
        method: "POST",
        body: JSON.stringify({ paperId, page: 1 }),
      }),
    );
    expect(r.status).toBe(401);
  });

  it("POST 403 when paper is owned by another user", async () => {
    const r = await POST(
      req("/api/paper-highlights", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperId: otherPaperId, page: 1 }),
      }),
    );
    expect(r.status).toBe(403);
  });

  it("POST 400 on validation failure (missing page)", async () => {
    const r = await POST(
      req("/api/paper-highlights", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperId }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("POST happy path inserts row matching schema", async () => {
    const r = await POST(
      req("/api/paper-highlights", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          paperId,
          page: 3,
          color: "yellow",
          noteMd: "Important bit",
          bbox: { x: 1, y: 2, w: 10, h: 5 },
        }),
      }),
    );
    expect(r.status).toBe(201);
    const row = await r.json();
    expect(typeof row.id).toBe("string");
    expect(row.paperId).toBe(paperId);
    expect(row.userId).toBe(u.id);
    expect(row.page).toBe(3);
    expect(row.color).toBe("yellow");
    expect(row.noteMd).toBe("Important bit");
    expect(row.bbox).toEqual({ x: 1, y: 2, w: 10, h: 5 });

    await DEL_ID(
      req(`/api/paper-highlights/${row.id}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: row.id }),
    );
  });

  it("GET returns only highlights for that paper and user", async () => {
    // Create a second paper for the same user, plus one highlight on each.
    const secondPaperId = await createPaper(u.cookie, libraryId, "second.pdf");

    const h1 = await POST(
      req("/api/paper-highlights", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperId, page: 1, noteMd: "A" }),
      }),
    );
    const r1 = await h1.json();

    const h2 = await POST(
      req("/api/paper-highlights", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperId: secondPaperId, page: 1, noteMd: "B" }),
      }),
    );
    const r2 = await h2.json();

    const list = await GET(
      req(`/api/paper-highlights?paperId=${paperId}`, { cookie: u.cookie }),
    );
    expect(list.status).toBe(200);
    const rows = await list.json();
    const ids = rows.map((r: any) => r.id);
    expect(ids).toContain(r1.id);
    expect(ids).not.toContain(r2.id);
    expect(rows.every((r: any) => r.paperId === paperId)).toBe(true);
    expect(rows.every((r: any) => r.userId === u.id)).toBe(true);

    // cleanup highlights (paper deletion would cascade too, but clean anyway)
    await DEL_ID(
      req(`/api/paper-highlights/${r1.id}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: r1.id }),
    );
    await DEL_ID(
      req(`/api/paper-highlights/${r2.id}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: r2.id }),
    );
    await DEL_PAPER(
      req(`/api/papers/${secondPaperId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: secondPaperId }),
    );
  });

  it("GET 403 for paper owned by another user", async () => {
    const r = await GET(
      req(`/api/paper-highlights?paperId=${otherPaperId}`, { cookie: u.cookie }),
    );
    expect(r.status).toBe(403);
  });

  it("DELETE 403 when highlight is owned by another user", async () => {
    const created = await POST(
      req("/api/paper-highlights", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperId, page: 2 }),
      }),
    );
    const row = await created.json();

    const bad = await DEL_ID(
      req(`/api/paper-highlights/${row.id}`, { method: "DELETE", cookie: other.cookie }),
      params({ id: row.id }),
    );
    expect(bad.status).toBe(403);

    // cleanup
    const ok = await DEL_ID(
      req(`/api/paper-highlights/${row.id}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: row.id }),
    );
    expect(ok.status).toBe(204);
  });

  it("DELETE owned removes the row", async () => {
    const created = await POST(
      req("/api/paper-highlights", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperId, page: 4 }),
      }),
    );
    const row = await created.json();

    const del = await DEL_ID(
      req(`/api/paper-highlights/${row.id}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: row.id }),
    );
    expect(del.status).toBe(204);

    const list = await GET(
      req(`/api/paper-highlights?paperId=${paperId}`, { cookie: u.cookie }),
    );
    const rows = await list.json();
    expect(rows.find((r: any) => r.id === row.id)).toBeUndefined();
  });
});
