import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { GET, POST, DELETE } from "./route";
import { PATCH as PATCH_ID, DELETE as DEL_ID } from "./[highlightId]/route";
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

const HMAC_SECRET = "test-user-highlights-secret";

async function createPaper(cookie: string, libId: number, filename = "uh.pdf") {
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

function defaultBody(pid: string, overrides: Record<string, unknown> = {}) {
  return {
    paperId: pid,
    pageNumber: 1,
    textContent: "Hello world",
    startOffset: 0,
    endOffset: 11,
    ...overrides,
  };
}

beforeAll(async () => {
  await ensureMinIOReady();
  u = await createTestUser();
  other = await createTestUser();

  const lib = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "UH Lib" }) }),
  );
  libraryId = (await lib.json()).id;

  const otherLib = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: other.cookie, body: JSON.stringify({ name: "UH Other Lib" }) }),
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

describe("user-highlights", () => {
  it("GET 401 when no user", async () => {
    const r = await GET(req(`/api/user-highlights?paperId=${paperId}`));
    expect(r.status).toBe(401);
  });

  it("GET 400 missing paperId", async () => {
    const r = await GET(req(`/api/user-highlights`, { cookie: u.cookie }));
    expect(r.status).toBe(400);
  });

  it("GET 403 for paper owned by another user", async () => {
    const r = await GET(req(`/api/user-highlights?paperId=${otherPaperId}`, { cookie: u.cookie }));
    expect(r.status).toBe(403);
  });

  it("POST 401 with no auth", async () => {
    const r = await POST(
      req("/api/user-highlights", {
        method: "POST",
        body: JSON.stringify(defaultBody(paperId)),
      }),
    );
    expect(r.status).toBe(401);
  });

  it("POST 400 on validation failure", async () => {
    const r = await POST(
      req("/api/user-highlights", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ paperId, pageNumber: 1 }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("POST 403 when paper owned by another user", async () => {
    const r = await POST(
      req("/api/user-highlights", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(defaultBody(otherPaperId)),
      }),
    );
    expect(r.status).toBe(403);
  });

  it("POST happy path inserts row with rich fields", async () => {
    const rects = [{ page: 1, x0: 1, y0: 2, x1: 3, y1: 4 }];
    const r = await POST(
      req("/api/user-highlights", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(defaultBody(paperId, {
          color: "green",
          note: "important",
          rects,
        })),
      }),
    );
    expect(r.status).toBe(201);
    const { highlight } = await r.json();
    expect(highlight.paperId).toBe(paperId);
    expect(highlight.userId).toBe(u.id);
    expect(highlight.pageNumber).toBe(1);
    expect(highlight.textContent).toBe("Hello world");
    expect(highlight.color).toBe("green");
    expect(highlight.note).toBe("important");
    expect(highlight.rects).toEqual(rects);

    await DEL_ID(
      req(`/api/user-highlights/${highlight.id}`, { method: "DELETE", cookie: u.cookie }),
      params({ highlightId: String(highlight.id) }),
    );
  });

  it("POST via HMAC dual-auth succeeds", async () => {
    const prevSecret = process.env.INHALE_INTERNAL_SECRET;
    process.env.INHALE_INTERNAL_SECRET = HMAC_SECRET;
    try {
      const path = "/api/user-highlights";
      const body = JSON.stringify(defaultBody(paperId, { textContent: "hmac" }));
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = createHmac("sha256", HMAC_SECRET)
        .update(ts + "POST" + path + body)
        .digest("hex");
      const r = await POST(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Inhale-User-Id": u.id,
            "X-Inhale-Ts": ts,
            "X-Inhale-Sig": sig,
          },
          body,
        }),
      );
      expect(r.status).toBe(201);
      const { highlight } = await r.json();
      expect(highlight.userId).toBe(u.id);
      await DEL_ID(
        req(`/api/user-highlights/${highlight.id}`, { method: "DELETE", cookie: u.cookie }),
        params({ highlightId: String(highlight.id) }),
      );
    } finally {
      if (prevSecret === undefined) delete process.env.INHALE_INTERNAL_SECRET;
      else process.env.INHALE_INTERNAL_SECRET = prevSecret;
    }
  });

  it("GET returns only highlights for that paper and user", async () => {
    const secondPaperId = await createPaper(u.cookie, libraryId, "second.pdf");

    const a = await POST(
      req("/api/user-highlights", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(defaultBody(paperId, { textContent: "A" })),
      }),
    );
    const aRow = (await a.json()).highlight;

    const b = await POST(
      req("/api/user-highlights", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(defaultBody(secondPaperId, { textContent: "B" })),
      }),
    );
    const bRow = (await b.json()).highlight;

    const list = await GET(req(`/api/user-highlights?paperId=${paperId}`, { cookie: u.cookie }));
    expect(list.status).toBe(200);
    const { highlights } = await list.json();
    const ids = highlights.map((h: { id: number }) => h.id);
    expect(ids).toContain(aRow.id);
    expect(ids).not.toContain(bRow.id);
    expect(highlights.every((h: { paperId: string }) => h.paperId === paperId)).toBe(true);

    // cleanup
    await DEL_ID(
      req(`/api/user-highlights/${aRow.id}`, { method: "DELETE", cookie: u.cookie }),
      params({ highlightId: String(aRow.id) }),
    );
    await DEL_ID(
      req(`/api/user-highlights/${bRow.id}`, { method: "DELETE", cookie: u.cookie }),
      params({ highlightId: String(bRow.id) }),
    );
    await DEL_PAPER(
      req(`/api/papers/${secondPaperId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: secondPaperId }),
    );
  });

  it("PATCH updates comment and rejects 404 for cross-user", async () => {
    const created = await POST(
      req("/api/user-highlights", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(defaultBody(paperId, { textContent: "patch me" })),
      }),
    );
    const row = (await created.json()).highlight;

    const ok = await PATCH_ID(
      req(`/api/user-highlights/${row.id}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ comment: "updated" }),
      }),
      params({ highlightId: String(row.id) }),
    );
    expect(ok.status).toBe(200);
    const updated = (await ok.json()).highlight;
    expect(updated.comment).toBe("updated");

    const bad = await PATCH_ID(
      req(`/api/user-highlights/${row.id}`, {
        method: "PATCH",
        cookie: other.cookie,
        body: JSON.stringify({ comment: "hijack" }),
      }),
      params({ highlightId: String(row.id) }),
    );
    expect(bad.status).toBe(404);

    await DEL_ID(
      req(`/api/user-highlights/${row.id}`, { method: "DELETE", cookie: u.cookie }),
      params({ highlightId: String(row.id) }),
    );
  });

  it("DELETE all by paperId removes only that paper's rows", async () => {
    const secondPaperId = await createPaper(u.cookie, libraryId, "third.pdf");
    await POST(req("/api/user-highlights", { method: "POST", cookie: u.cookie, body: JSON.stringify(defaultBody(paperId)) }));
    await POST(req("/api/user-highlights", { method: "POST", cookie: u.cookie, body: JSON.stringify(defaultBody(paperId, { textContent: "second" })) }));
    await POST(req("/api/user-highlights", { method: "POST", cookie: u.cookie, body: JSON.stringify(defaultBody(secondPaperId, { textContent: "keep" })) }));

    const del = await DELETE(req(`/api/user-highlights?paperId=${paperId}`, { method: "DELETE", cookie: u.cookie }));
    expect(del.status).toBe(204);

    const remaining = await GET(req(`/api/user-highlights?paperId=${paperId}`, { cookie: u.cookie }));
    expect((await remaining.json()).highlights).toEqual([]);

    const other = await GET(req(`/api/user-highlights?paperId=${secondPaperId}`, { cookie: u.cookie }));
    const { highlights } = await other.json();
    expect(highlights.length).toBe(1);
    expect(highlights[0].textContent).toBe("keep");

    // cleanup
    await DELETE(req(`/api/user-highlights?paperId=${secondPaperId}`, { method: "DELETE", cookie: u.cookie }));
    await DEL_PAPER(
      req(`/api/papers/${secondPaperId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: secondPaperId }),
    );
  });
});
