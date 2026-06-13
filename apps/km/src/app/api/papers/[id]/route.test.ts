import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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
import { folders, libraries, paperHighlights, papers, references_ } from "@episteme/db/schema";
import { getTrashFolderId } from "@/lib/folders-server";

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

  it("200 sets folderId to owned folder", async () => {
    const paperId = await initPaper();
    const [f] = await db.insert(folders).values({
      libraryId, userId: u.id, parentId: null, name: `pf-${Date.now()}`,
    }).returning({ id: folders.id });
    const r = await PATCH(
      req(`/api/papers/${paperId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ folderId: f.id }),
      }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(200);
    const [row] = await db.select({ folderId: papers.folderId }).from(papers).where(eq(papers.id, paperId));
    expect(row.folderId).toBe(f.id);
  });

  it("200 clears folderId when null", async () => {
    const paperId = await initPaper();
    const [f] = await db.insert(folders).values({
      libraryId, userId: u.id, parentId: null, name: `pf2-${Date.now()}`,
    }).returning({ id: folders.id });
    await db.update(papers).set({ folderId: f.id }).where(eq(papers.id, paperId));
    const r = await PATCH(
      req(`/api/papers/${paperId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ folderId: null }),
      }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(200);
    const [row] = await db.select({ folderId: papers.folderId }).from(papers).where(eq(papers.id, paperId));
    expect(row.folderId).toBe(null);
  });

  it("404 cross-user folderId", async () => {
    const paperId = await initPaper();
    const [otherLib] = await db.insert(libraries).values({ userId: other.id, name: "other lib" }).returning({ id: libraries.id });
    const [otherFolder] = await db.insert(folders).values({
      libraryId: otherLib.id, userId: other.id, parentId: null, name: `otherf-${Date.now()}`,
    }).returning({ id: folders.id });
    const r = await PATCH(
      req(`/api/papers/${paperId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ folderId: otherFolder.id }),
      }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(404);
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

async function getTrashId(): Promise<string> {
  return getTrashFolderId(libraryId, u.id);
}

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

  it("400 rejects delete when paper is not in trash", async () => {
    const paperId = await initPaper();
    const r = await DELETE(
      req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: paperId }),
    );
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("items must be in trash before permanent delete");
  });

  it(
    "deletes row + source + cover blobs, cascades paper_highlights (paper in trash)",
    async () => {
      const paperId = await initAndFinalize();

      // Move paper to trash before deleting.
      const trashId = await getTrashId();
      await db.update(papers).set({ folderId: trashId }).where(eq(papers.id, paperId));

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

  it("GSD-97: hard-delete also purges the linked ref-twin row", async () => {
    const paperId = await initPaper();
    const trashId = await getTrashId();
    await db.update(papers).set({ folderId: trashId }).where(eq(papers.id, paperId));

    const [twin] = await db.insert(references_).values({
      libraryId, userId: u.id, folderPath: "", folderId: trashId,
      citationKey: `gsd97-${Date.now()}`, cslJson: { id: paperId, title: "twin" },
      paperId,
    }).returning({ id: references_.id });

    const del = await DELETE(
      req(`/api/papers/${paperId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: paperId }),
    );
    expect(del.status).toBe(204);

    const twinLeft = await db.select().from(references_).where(eq(references_.id, twin.id));
    expect(twinLeft).toHaveLength(0);
  });
});
