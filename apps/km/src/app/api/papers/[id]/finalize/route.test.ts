import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as POST_PAPER } from "../../route";
import { PATCH as PATCH_PAPER, GET as GET_PAPER } from "../route";
import { DELETE as DEL_PAPER } from "../route";
import { POST as POST_FINALIZE } from "./route";
import { POST as POST_LIB } from "../../../libraries/route";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../../../_test-utils";
import { ensureMinIOReady } from "../../../_minio-setup";
import { storage, paperSourceKey, paperCoverKey } from "@/lib/storage";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";
import { eq } from "drizzle-orm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF_PATH = path.join(
  __dirname,
  "../../../../../../e2e/fixtures/sample.pdf",
);

let u: TestUser;
let libraryId: number;
let sampleBytes: Buffer;
const createdPaperIds: string[] = [];

beforeAll(async () => {
  await ensureMinIOReady();
  u = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Finalize Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
  sampleBytes = await readFile(SAMPLE_PDF_PATH);
}, 60_000);

afterAll(async () => {
  // Swallow 404s — some tests intentionally skip PUT, others already cleaned up.
  for (const pid of createdPaperIds) {
    await storage.deleteObject(paperSourceKey(pid)).catch(() => {});
    await storage.deleteObject(paperCoverKey(pid)).catch(() => {});
  }
  await deleteTestUser(u.id);
});

async function initUpload(filename = "sample.pdf"): Promise<{ paperId: string; uploadUrl: string }> {
  const r = await POST_PAPER(
    req("/api/papers", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        libraryId,
        filename,
        contentType: "application/pdf",
        sizeBytes: sampleBytes.length,
      }),
    }),
  );
  if (r.status !== 201) throw new Error(`init upload failed: ${r.status}`);
  const body = await r.json();
  createdPaperIds.push(body.paperId);
  return body;
}

async function putSource(uploadUrl: string, bytes: Buffer): Promise<void> {
  // Reuse bytes across fetches — copy each time to avoid any Undici
  // transformations on shared buffers.
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: new Uint8Array(bytes),
    headers: { "content-type": "application/pdf" },
  });
  if (!res.ok) throw new Error(`PUT source failed: ${res.status} ${await res.text()}`);
}

describe("POST /api/papers/:id/finalize", () => {
  it("401 no user", async () => {
    const r = await POST_FINALIZE(
      req(`/api/papers/00000000-0000-0000-0000-000000000000/finalize`, { method: "POST" }),
      params({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(r.status).toBe(401);
  });

  it("404 when paper does not exist", async () => {
    const r = await POST_FINALIZE(
      req(`/api/papers/00000000-0000-0000-0000-000000000000/finalize`, {
        method: "POST",
        cookie: u.cookie,
      }),
      params({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(r.status).toBe(404);
  });

  it("422 when source object is missing", async () => {
    const { paperId } = await initUpload();
    // Intentionally skip the PUT.
    const r = await POST_FINALIZE(
      req(`/api/papers/${paperId}/finalize`, { method: "POST", cookie: u.cookie }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(422);
    await DEL_PAPER(
      req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: paperId }),
    );
  });

  it(
    "extracts metadata + cover from uploaded PDF",
    async () => {
      const { paperId, uploadUrl } = await initUpload();
      await putSource(uploadUrl, sampleBytes);

      const r = await POST_FINALIZE(
        req(`/api/papers/${paperId}/finalize`, { method: "POST", cookie: u.cookie }),
        params({ id: paperId }),
      );
      expect(r.status).toBe(200);
      const paper = await r.json();
      expect(paper.title).toBe("Attention Is All You Need");
      expect(paper.year).toBe(2017);
      expect(Array.isArray(paper.authors)).toBe(true);
      expect(paper.authors.length).toBeGreaterThan(0);
      expect(paper.authors).toContain("Ashish Vaswani");
      expect(paper.storageUrl).toBe(paperSourceKey(paperId));

      // Cover should exist — fetch via presigned GET.
      const coverUrl = await storage.getPresignedGet(paperCoverKey(paperId), 60);
      const coverRes = await fetch(coverUrl);
      expect(coverRes.status).toBe(200);
      const coverBytes = new Uint8Array(await coverRes.arrayBuffer());
      expect(coverBytes.length).toBeGreaterThan(2048);
      // PNG signature.
      expect(coverBytes[0]).toBe(0x89);
      expect(coverBytes[1]).toBe(0x50);

      await DEL_PAPER(
        req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }),
        params({ id: paperId }),
      );
    },
    30_000,
  );

  it(
    "idempotent: re-finalize does not clobber user-edited title",
    async () => {
      const { paperId, uploadUrl } = await initUpload();
      await putSource(uploadUrl, sampleBytes);

      // First finalize — title becomes extracted value.
      const first = await POST_FINALIZE(
        req(`/api/papers/${paperId}/finalize`, { method: "POST", cookie: u.cookie }),
        params({ id: paperId }),
      );
      expect(first.status).toBe(200);

      // User edits title.
      const edited = await PATCH_PAPER(
        req(`/api/papers/${paperId}`, {
          method: "PATCH",
          cookie: u.cookie,
          body: JSON.stringify({ title: "User Edited Title" }),
        }),
        params({ id: paperId }),
      );
      expect((await edited.json()).title).toBe("User Edited Title");

      // Second finalize must NOT overwrite the user's title.
      const second = await POST_FINALIZE(
        req(`/api/papers/${paperId}/finalize`, { method: "POST", cookie: u.cookie }),
        params({ id: paperId }),
      );
      expect(second.status).toBe(200);
      const paper = await second.json();
      expect(paper.title).toBe("User Edited Title");
      // Year + authors were already set by the first finalize; they should remain.
      expect(paper.year).toBe(2017);
      expect(paper.authors).toContain("Ashish Vaswani");

      await DEL_PAPER(
        req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }),
        params({ id: paperId }),
      );
    },
    30_000,
  );

  it(
    "POST /papers does not persist client-supplied sizeBytes (stays 0 until finalize)",
    async () => {
      const r = await POST_PAPER(
        req("/api/papers", {
          method: "POST",
          cookie: u.cookie,
          body: JSON.stringify({
            libraryId,
            filename: "sample-noinit.pdf",
            contentType: "application/pdf",
            sizeBytes: 999_999,
          }),
        }),
      );
      expect(r.status).toBe(201);
      const { paperId } = await r.json();
      createdPaperIds.push(paperId);

      const [row] = await db
        .select({ sizeBytes: papers.sizeBytes })
        .from(papers)
        .where(eq(papers.id, paperId));
      // Client-supplied 999_999 must NOT be persisted — only finalize HEAD writes real bytes.
      expect(row.sizeBytes).toBe(0);

      await DEL_PAPER(
        req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }),
        params({ id: paperId }),
      );
    },
    30_000,
  );

  it(
    "sizeBytes stays 0 when finalize HEAD fails (source missing)",
    async () => {
      const r = await POST_PAPER(
        req("/api/papers", {
          method: "POST",
          cookie: u.cookie,
          body: JSON.stringify({
            libraryId,
            filename: "sample-headfail.pdf",
            contentType: "application/pdf",
            sizeBytes: 12345,
          }),
        }),
      );
      expect(r.status).toBe(201);
      const { paperId } = await r.json();
      createdPaperIds.push(paperId);

      // Skip PUT — finalize HEAD will 404.
      const fin = await POST_FINALIZE(
        req(`/api/papers/${paperId}/finalize`, { method: "POST", cookie: u.cookie }),
        params({ id: paperId }),
      );
      expect(fin.status).toBe(422);

      const [row] = await db
        .select({ sizeBytes: papers.sizeBytes })
        .from(papers)
        .where(eq(papers.id, paperId));
      expect(row.sizeBytes).toBe(0);

      await DEL_PAPER(
        req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }),
        params({ id: paperId }),
      );
    },
    30_000,
  );

  it(
    "overwrites papers.sizeBytes with actual R2 content-length",
    async () => {
      // Init with a deliberately wrong claimed sizeBytes (1 byte) — finalize
      // must overwrite with the real Content-Length from the R2 HEAD.
      const r = await POST_PAPER(
        req("/api/papers", {
          method: "POST",
          cookie: u.cookie,
          body: JSON.stringify({
            libraryId,
            filename: "sample-size.pdf",
            contentType: "application/pdf",
            sizeBytes: 1,
          }),
        }),
      );
      expect(r.status).toBe(201);
      const { paperId, uploadUrl } = await r.json();
      createdPaperIds.push(paperId);
      await putSource(uploadUrl, sampleBytes);

      const fin = await POST_FINALIZE(
        req(`/api/papers/${paperId}/finalize`, { method: "POST", cookie: u.cookie }),
        params({ id: paperId }),
      );
      expect(fin.status).toBe(200);

      const [row] = await db
        .select({ sizeBytes: papers.sizeBytes })
        .from(papers)
        .where(eq(papers.id, paperId));
      expect(row.sizeBytes).toBe(sampleBytes.length);

      await DEL_PAPER(
        req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }),
        params({ id: paperId }),
      );
    },
    30_000,
  );

  it(
    "rejects oversized source PDF with 413",
    async () => {
      const { paperId, uploadUrl } = await initUpload();
      // Small PUT through the presigned URL (signature binds content-type,
      // not length), then overwrite via the SDK with a >50 MB payload.
      await putSource(uploadUrl, Buffer.alloc(16));
      const big = randomBytes(50 * 1024 * 1024 + 1);
      await storage.uploadObject(paperSourceKey(paperId), big, "application/pdf");

      const r = await POST_FINALIZE(
        req(`/api/papers/${paperId}/finalize`, { method: "POST", cookie: u.cookie }),
        params({ id: paperId }),
      );
      expect(r.status).toBe(413);
      expect((await r.json()).error).toBe("payload_too_large");

      await DEL_PAPER(
        req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }),
        params({ id: paperId }),
      );
    },
    60_000,
  );
});
