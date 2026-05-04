import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as POST_PAPER } from "../../route";
import { DELETE as DEL_PAPER } from "../route";
import { POST as POST_FINALIZE } from "../finalize/route";
import { GET as GET_FILE } from "./route";
import { POST as POST_LIB } from "../../../libraries/route";
import {
  createAnonTestUser,
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../../../_test-utils";
import { ensureMinIOReady } from "../../../_minio-setup";
import { storage, paperSourceKey, paperCoverKey } from "@/lib/storage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF_PATH = path.join(
  __dirname,
  "../../../../../../e2e/fixtures/sample.pdf",
);

let u: TestUser;
let other: TestUser;
let anon: TestUser;
let libraryId: number;
let anonLibraryId: number;
let sampleBytes: Buffer;
const createdPaperIds: string[] = [];

beforeAll(async () => {
  await ensureMinIOReady();
  u = await createTestUser();
  other = await createTestUser();
  anon = await createAnonTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "File Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
  const anonLib = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: anon.cookie,
      body: JSON.stringify({ name: "Anon File Lib" }),
    }),
  );
  anonLibraryId = (await anonLib.json()).id;
  sampleBytes = await readFile(SAMPLE_PDF_PATH);
}, 60_000);

afterAll(async () => {
  for (const pid of createdPaperIds) {
    await storage.deleteObject(paperSourceKey(pid)).catch(() => {});
    await storage.deleteObject(paperCoverKey(pid)).catch(() => {});
  }
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
  await deleteTestUser(anon.id);
});

async function initAndUpload(): Promise<string> {
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
  if (r.status !== 201) throw new Error(`init failed: ${r.status}`);
  const body = await r.json();
  const paperId: string = body.paperId;
  createdPaperIds.push(paperId);
  const put = await fetch(body.uploadUrl, {
    method: "PUT",
    body: new Uint8Array(sampleBytes),
    headers: { "content-type": "application/pdf" },
  });
  if (!put.ok) throw new Error(`PUT failed: ${put.status}`);
  return paperId;
}

async function initAndUploadAnon(): Promise<string> {
  const r = await POST_PAPER(
    req("/api/papers", {
      method: "POST",
      cookie: anon.cookie,
      body: JSON.stringify({
        libraryId: anonLibraryId,
        filename: "anon-sample.pdf",
        contentType: "application/pdf",
        sizeBytes: sampleBytes.length,
      }),
    }),
  );
  if (r.status !== 201) throw new Error(`anon init failed: ${r.status}`);
  const body = await r.json();
  const paperId: string = body.paperId;
  createdPaperIds.push(paperId);
  const put = await fetch(body.uploadUrl, {
    method: "PUT",
    body: new Uint8Array(sampleBytes),
    headers: { "content-type": "application/pdf" },
  });
  if (!put.ok) throw new Error(`anon PUT failed: ${put.status}`);
  return paperId;
}

const MISSING_ID = "00000000-0000-0000-0000-000000000000";

describe("GET /api/papers/:id/file", () => {
  it("401 no user", async () => {
    const r = await GET_FILE(
      req(`/api/papers/${MISSING_ID}/file`),
      params({ id: MISSING_ID }),
    );
    expect(r.status).toBe(401);
  });

  it("404 missing paper", async () => {
    const r = await GET_FILE(
      req(`/api/papers/${MISSING_ID}/file`, { cookie: u.cookie }),
      params({ id: MISSING_ID }),
    );
    expect(r.status).toBe(404);
  });

  it("403 other user's paper", async () => {
    const paperId = await initAndUpload();
    const r = await GET_FILE(
      req(`/api/papers/${paperId}/file`, { cookie: other.cookie }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(403);

    await DEL_PAPER(
      req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: paperId }),
    );
  });

  it("200 streams PDF bytes from storage", async () => {
    const paperId = await initAndUpload();
    const r = await GET_FILE(
      req(`/api/papers/${paperId}/file`, { cookie: u.cookie }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("cache-control")).toBe("private, no-store");

    const bytes = new Uint8Array(await r.arrayBuffer());
    expect(bytes.length).toBe(sampleBytes.length);

    await DEL_PAPER(
      req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: paperId }),
    );
  }, 30_000);

  it("forwards byte-range requests for PDF.js", async () => {
    const paperId = await initAndUpload();
    const r = await GET_FILE(
      req(`/api/papers/${paperId}/file`, {
        cookie: u.cookie,
        headers: { range: "bytes=0-255" },
      }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toMatch(/^bytes 0-255\/\d+$/);
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect(bytes.length).toBe(256);

    await DEL_PAPER(
      req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: paperId }),
    );
  }, 30_000);

  it("200 for anonymous user's own paper", async () => {
    const paperId = await initAndUploadAnon();
    const r = await GET_FILE(
      req(`/api/papers/${paperId}/file`, { cookie: anon.cookie }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/pdf");
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect(bytes.length).toBe(sampleBytes.length);

    await DEL_PAPER(
      req(`/api/papers/${paperId}`, { method: "DELETE", cookie: anon.cookie }),
      params({ id: paperId }),
    );
  }, 30_000);
});
