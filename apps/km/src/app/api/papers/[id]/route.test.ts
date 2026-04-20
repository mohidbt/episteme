import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST as POST_PAPER } from "../route";
import { DELETE, GET, PATCH } from "./route";
import { POST as POST_FINALIZE } from "./finalize/route";
import { POST as POST_LIB } from "../../libraries/route";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../../_test-utils";
import { ensureMinIOReady } from "../../_minio-setup";
import { storage, paperSourceKey, paperCoverKey } from "@/lib/storage";
import { db } from "@/lib/db";
import { paperHighlights } from "@episteme/db/schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF_PATH = path.join(
  __dirname,
  "../../../../../e2e/fixtures/sample.pdf",
);

let u: TestUser;
let other: TestUser;
let libraryId: number;
let sampleBytes: Buffer;
const createdPaperIds: string[] = [];

beforeAll(async () => {
  await ensureMinIOReady();
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Paper ID Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
  sampleBytes = await readFile(SAMPLE_PDF_PATH);
}, 60_000);

afterAll(async () => {
  for (const pid of createdPaperIds) {
    await storage.deleteObject(paperSourceKey(pid)).catch(() => {});
    await storage.deleteObject(paperCoverKey(pid)).catch(() => {});
  }
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

async function initPaper(filename = "a.pdf"): Promise<string> {
  const r = await POST_PAPER(
    req("/api/papers", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        libraryId,
        filename,
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

async function putSource(uploadUrl: string, bytes: Buffer): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: new Uint8Array(bytes),
    headers: { "content-type": "application/pdf" },
  });
  if (!res.ok) throw new Error(`PUT source failed: ${res.status}`);
}

async function initAndFinalize(): Promise<string> {
  const r = await POST_PAPER(
    req("/api/papers", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        libraryId,
        filename: "sample.pdf",
        contentType: "application/pdf",
        sizeBytes: sampleBytes.length,
      }),
    }),
  );
  if (r.status !== 201) throw new Error(`init paper failed: ${r.status}`);
  const body = await r.json();
  const paperId: string = body.paperId;
  createdPaperIds.push(paperId);
  await putSource(body.uploadUrl, sampleBytes);
  const fin = await POST_FINALIZE(
    req(`/api/papers/${paperId}/finalize`, { method: "POST", cookie: u.cookie }),
    params({ id: paperId }),
  );
  if (fin.status !== 200) {
    throw new Error(`finalize failed: ${fin.status}`);
  }
  return paperId;
}

const MISSING_ID = "00000000-0000-0000-0000-000000000000";

describe("PATCH /api/papers/:id", () => {
  it("401 no user", async () => {
    const r = await PATCH(
      req(`/api/papers/${MISSING_ID}`, { method: "PATCH", body: JSON.stringify({ title: "x" }) }),
      params({ id: MISSING_ID }),
    );
    expect(r.status).toBe(401);
  });

  it("404 on missing paper", async () => {
    const r = await PATCH(
      req(`/api/papers/${MISSING_ID}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ title: "x" }),
      }),
      params({ id: MISSING_ID }),
    );
    expect(r.status).toBe(404);
  });

  it("403 on other user's paper", async () => {
    const paperId = await initPaper();
    const r = await PATCH(
      req(`/api/papers/${paperId}`, {
        method: "PATCH",
        cookie: other.cookie,
        body: JSON.stringify({ title: "hack" }),
      }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(403);
  });

  it("400 rejects filename in body", async () => {
    const paperId = await initPaper();
    const r = await PATCH(
      req(`/api/papers/${paperId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ filename: "evil.pdf" }),
      }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(400);
  });

  it("400 rejects storageUrl in body", async () => {
    const paperId = await initPaper();
    const r = await PATCH(
      req(`/api/papers/${paperId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ storageUrl: "http://evil" }),
      }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(400);
  });

  it("400 rejects venue in body", async () => {
    const paperId = await initPaper();
    const r = await PATCH(
      req(`/api/papers/${paperId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ venue: "NeurIPS" }),
      }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(400);
  });

  it("400 rejects empty title", async () => {
    const paperId = await initPaper();
    const r = await PATCH(
      req(`/api/papers/${paperId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ title: "" }),
      }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(400);
  });

  it("200 updates title/authors/year/doi/folderPath", async () => {
    const paperId = await initPaper();
    const r = await PATCH(
      req(`/api/papers/${paperId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({
          title: "New Title",
          authors: ["Alice", "Bob"],
          year: 2024,
          doi: "10.1000/xyz",
          folderPath: "papers/",
        }),
      }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(200);
    const row = await r.json();
    expect(row.title).toBe("New Title");
    expect(row.authors).toEqual(["Alice", "Bob"]);
    expect(row.year).toBe(2024);
    expect(row.doi).toBe("10.1000/xyz");
    expect(row.folderPath).toBe("papers/");
  });

  it("200 clears doi when null", async () => {
    const paperId = await initPaper();
    // Seed doi first.
    const seeded = await PATCH(
      req(`/api/papers/${paperId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ doi: "10.1000/seed" }),
      }),
      params({ id: paperId }),
    );
    expect((await seeded.json()).doi).toBe("10.1000/seed");

    // Now null it out.
    const cleared = await PATCH(
      req(`/api/papers/${paperId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ doi: null }),
      }),
      params({ id: paperId }),
    );
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).doi).toBe(null);
  });
});

describe("DELETE /api/papers/:id", () => {
  it("401 no user", async () => {
    const r = await DELETE(
      req(`/api/papers/${MISSING_ID}`, { method: "DELETE" }),
      params({ id: MISSING_ID }),
    );
    expect(r.status).toBe(401);
  });

  it("404 missing paper", async () => {
    const r = await DELETE(
      req(`/api/papers/${MISSING_ID}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: MISSING_ID }),
    );
    expect(r.status).toBe(404);
  });

  it("403 other user's paper", async () => {
    const paperId = await initPaper();
    const r = await DELETE(
      req(`/api/papers/${paperId}`, { method: "DELETE", cookie: other.cookie }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(403);
  });

  it(
    "deletes row + source + cover blobs, cascades paper_highlights",
    async () => {
      const paperId = await initAndFinalize();

      // Seed a highlight row so we can assert cascade delete.
      const [hl] = await db
        .insert(paperHighlights)
        .values({
          paperId,
          userId: u.id,
          page: 1,
          color: "yellow",
          noteMd: "hi",
        })
        .returning();
      expect(hl.paperId).toBe(paperId);

      // Verify source + cover exist via HEAD.
      const srcHeadBefore = await fetch(
        await storage.getPresignedHead(paperSourceKey(paperId), 60),
        { method: "HEAD" },
      );
      expect(srcHeadBefore.status).toBe(200);
      const coverHeadBefore = await fetch(
        await storage.getPresignedHead(paperCoverKey(paperId), 60),
        { method: "HEAD" },
      );
      expect(coverHeadBefore.status).toBe(200);

      const del = await DELETE(
        req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }),
        params({ id: paperId }),
      );
      expect(del.status).toBe(204);

      // DB row gone.
      const getAfter = await GET(
        req(`/api/papers/${paperId}`, { cookie: u.cookie }),
        params({ id: paperId }),
      );
      expect(getAfter.status).toBe(404);

      // Highlights cascaded.
      const hls = await db
        .select()
        .from(paperHighlights)
        .where(eq(paperHighlights.paperId, paperId));
      expect(hls.length).toBe(0);

      // Blobs gone — MinIO HEAD returns 404.
      const srcHeadAfter = await fetch(
        await storage.getPresignedHead(paperSourceKey(paperId), 60),
        { method: "HEAD" },
      );
      expect(srcHeadAfter.status).toBe(404);
      const coverHeadAfter = await fetch(
        await storage.getPresignedHead(paperCoverKey(paperId), 60),
        { method: "HEAD" },
      );
      expect(coverHeadAfter.status).toBe(404);
    },
    60_000,
  );
});
