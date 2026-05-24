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
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, papers, folders, TRASH_FOLDER_NAME } from "@episteme/db/schema";

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
  // K9: guest-gated POST /api/libraries means we seed the anon user's
  // library via direct DB insert. The anon-side test exercises that the
  // FILE-GET path (reader image streaming) works for guests on a paper
  // they already own — uploading new content is a separate, gated path.
  const [anonLib] = await db
    .insert(libraries)
    .values({ userId: anon.id, name: "Anon File Lib" })
    .returning();
  anonLibraryId = anonLib.id;
  // Seed the trash folder (matches what POST /api/libraries does) so DELETE
  // can move the paper to trash before the cleanup step.
  await db.insert(folders).values({
    libraryId: anonLibraryId,
    userId: anon.id,
    parentId: null,
    name: TRASH_FOLDER_NAME,
    isTrash: true,
  });
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
  // K9: POST /api/papers is now guest-gated. For the FILE-GET test (which
  // only exercises that anon owners can read their own paper bytes), seed
  // the row + storage object directly — bypassing the upload-init gate is
  // exactly what the seed path does in production for anon users.
  const [row] = await db
    .insert(papers)
    .values({
      libraryId: anonLibraryId,
      userId: anon.id,
      filename: "anon-sample.pdf",
      title: "Anon Sample",
      sizeBytes: sampleBytes.length,
      storageUrl: "",
    })
    .returning();
  await storage.uploadObject(
    paperSourceKey(row.id),
    Buffer.from(sampleBytes),
    "application/pdf",
  );
  await db
    .update(papers)
    .set({ storageUrl: paperSourceKey(row.id) })
    .where(eq(papers.id, row.id));
  createdPaperIds.push(row.id);
  return row.id;
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
