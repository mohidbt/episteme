import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET, POST } from "./route";
import {
  DELETE as DEL_ID,
  GET as GET_ID,
  PATCH as PATCH_ID,
} from "./[id]/route";
import { POST as POST_LIB } from "../libraries/route";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../_test-utils";
import { ensureMinIOReady } from "../_minio-setup";
import { storage, paperSourceKey, paperCoverKey } from "@/lib/storage";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";
import { getTrashFolderId } from "@/lib/folders-server";

let u: TestUser;
let other: TestUser;
let libraryId: number;
const createdPaperIds: string[] = [];

/** Move paper to trash then permanently delete (satisfies T20 guard). */
async function trashAndDelete(paperId: string): Promise<void> {
  const trashId = await getTrashFolderId(libraryId, u.id);
  await db.update(papers).set({ folderId: trashId }).where(eq(papers.id, paperId));
  await DEL_ID(req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }), params({ id: paperId }));
}

beforeAll(async () => {
  await ensureMinIOReady();
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Papers Lib" }) }),
  );
  libraryId = (await r.json()).id;
}, 60_000);

afterAll(async () => {
  for (const pid of createdPaperIds) {
    await storage.deleteObject(paperSourceKey(pid)).catch(() => {});
    await storage.deleteObject(paperCoverKey(pid)).catch(() => {});
  }
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

const initUpload = (overrides: Record<string, unknown> = {}) => ({
  libraryId,
  filename: "a.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
  ...overrides,
});

describe("papers", () => {
  it("401 no user", async () => {
    const r = await GET(req("/api/papers?libraryId=" + libraryId));
    expect(r.status).toBe(401);
  });

  it("400 missing libraryId", async () => {
    const r = await GET(req("/api/papers", { cookie: u.cookie }));
    expect(r.status).toBe(400);
  });

  it("400 validation on POST", async () => {
    const r = await POST(
      req("/api/papers", { method: "POST", cookie: u.cookie, body: JSON.stringify({ libraryId }) }),
    );
    expect(r.status).toBe(400);
  });

  it("400 rejects non-PDF contentType", async () => {
    const r = await POST(
      req("/api/papers", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ contentType: "image/png" })),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("403 initializing upload in other user's library", async () => {
    const r = await POST(
      req("/api/papers", { method: "POST", cookie: other.cookie, body: JSON.stringify(initUpload()) }),
    );
    expect(r.status).toBe(403);
  });

  it("POST returns presigned uploadUrl with X-Amz-Signature", async () => {
    const r = await POST(
      req("/api/papers", { method: "POST", cookie: u.cookie, body: JSON.stringify(initUpload()) }),
    );
    expect(r.status).toBe(201);
    const body = await r.json();
    createdPaperIds.push(body.paperId);
    expect(typeof body.paperId).toBe("string");
    const url = new URL(body.uploadUrl);
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(url.pathname.endsWith(`/${body.paperId}/source.pdf`)).toBe(true);

    // Clean up so later tests that snapshot listing aren't polluted.
    await trashAndDelete(body.paperId);
  });

  it("creates row with placeholder title = filenameToTitle(filename)", async () => {
    const r = await POST(
      req("/api/papers", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "My Great Paper.pdf" })),
      }),
    );
    const { paperId } = await r.json();
    createdPaperIds.push(paperId);
    const one = await GET_ID(req(`/api/papers/${paperId}`, { cookie: u.cookie }), params({ id: paperId }));
    const paper = await one.json();
    expect(paper.title).toBe("My Great Paper");
    expect(paper.filename).toBe("My Great Paper.pdf");
    expect(paper.storageUrl).toBe(null);

    await trashAndDelete(paperId);
  });

  it("golden path: init → CRUD", async () => {
    const c = await POST(req("/api/papers", { method: "POST", cookie: u.cookie, body: JSON.stringify(initUpload()) }));
    expect(c.status).toBe(201);
    const { paperId } = await c.json();
    createdPaperIds.push(paperId);

    const list = await GET(req(`/api/papers?libraryId=${libraryId}`, { cookie: u.cookie }));
    const rows = await list.json();
    expect(rows.some((r: any) => r.id === paperId)).toBe(true);

    const one = await GET_ID(req(`/api/papers/${paperId}`, { cookie: u.cookie }), params({ id: paperId }));
    expect(one.status).toBe(200);

    const patched = await PATCH_ID(
      req(`/api/papers/${paperId}`, { method: "PATCH", cookie: u.cookie, body: JSON.stringify({ title: "Beta" }) }),
      params({ id: paperId }),
    );
    expect((await patched.json()).title).toBe("Beta");

    await trashAndDelete(paperId);
  });

  it("ownership: cannot patch other's paper", async () => {
    const c = await POST(req("/api/papers", { method: "POST", cookie: u.cookie, body: JSON.stringify(initUpload()) }));
    const { paperId } = await c.json();
    createdPaperIds.push(paperId);
    const r = await PATCH_ID(
      req(`/api/papers/${paperId}`, { method: "PATCH", cookie: other.cookie, body: JSON.stringify({ title: "hack" }) }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(403);

    await trashAndDelete(paperId);
  });

  it("folderPath filter", async () => {
    const c = await POST(
      req("/api/papers", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "in-folder.pdf", folderPath: "foo/" })),
      }),
    );
    const { paperId } = await c.json();
    createdPaperIds.push(paperId);
    const r = await GET(req(`/api/papers?libraryId=${libraryId}&folderPath=foo/`, { cookie: u.cookie }));
    const rows = await r.json();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p: any) => p.folderPath === "foo/")).toBe(true);

    await trashAndDelete(paperId);
  });

  it("allows duplicate filename in same folder (two distinct rows)", async () => {
    const a = await POST(
      req("/api/papers", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "sample.pdf" })),
      }),
    );
    const b = await POST(
      req("/api/papers", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "sample.pdf" })),
      }),
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const aBody = await a.json();
    const bBody = await b.json();
    createdPaperIds.push(aBody.paperId, bBody.paperId);
    expect(aBody.paperId).not.toBe(bBody.paperId);

    await trashAndDelete(aBody.paperId);
    await trashAndDelete(bBody.paperId);
  });

  it("GET lists by addedAt desc (newest first)", async () => {
    const first = await POST(
      req("/api/papers", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "order-first.pdf", folderPath: "order/" })),
      }),
    );
    const { paperId: firstId } = await first.json();
    createdPaperIds.push(firstId);

    // Ensure a measurable addedAt delta (timestamp has ms resolution).
    await new Promise((r) => setTimeout(r, 15));

    const second = await POST(
      req("/api/papers", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "order-second.pdf", folderPath: "order/" })),
      }),
    );
    const { paperId: secondId } = await second.json();
    createdPaperIds.push(secondId);

    const list = await GET(
      req(`/api/papers?libraryId=${libraryId}&folderPath=order/`, { cookie: u.cookie }),
    );
    const rows = await list.json();
    expect(rows[0].id).toBe(secondId);
    expect(rows[1].id).toBe(firstId);

    await trashAndDelete(firstId);
    await trashAndDelete(secondId);
  });
});
