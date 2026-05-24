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
  createAnonTestUser,
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../_test-utils";
import { ensureMinIOReady } from "../_minio-setup";
import { storage, assetSourceKey } from "@/lib/storage";
import { db } from "@/lib/db";
import { assets } from "@episteme/db/schema";

let u: TestUser;
let other: TestUser;
let libraryId: number;
const createdAssetIds: string[] = [];

beforeAll(async () => {
  await ensureMinIOReady();
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Assets Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
}, 60_000);

afterAll(async () => {
  for (const id of createdAssetIds) {
    await storage.deleteObject(assetSourceKey(id)).catch(() => {});
  }
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

const initUpload = (overrides: Record<string, unknown> = {}) => ({
  libraryId,
  filename: "fig.png",
  contentType: "image/png",
  sizeBytes: 2048,
  ...overrides,
});

describe("assets", () => {
  it("401 no user on GET", async () => {
    const r = await GET(req(`/api/assets?libraryId=${libraryId}`));
    expect(r.status).toBe(401);
  });

  it("401 no user on POST", async () => {
    const r = await POST(
      req("/api/assets", { method: "POST", body: JSON.stringify(initUpload()) }),
    );
    expect(r.status).toBe(401);
  });

  it("400 missing libraryId on GET", async () => {
    const r = await GET(req("/api/assets", { cookie: u.cookie }));
    expect(r.status).toBe(400);
  });

  it("400 validation on POST (missing fields)", async () => {
    const r = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("403 initializing upload in other user's library", async () => {
    const r = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify(initUpload()),
      }),
    );
    expect(r.status).toBe(403);
  });

  // K9: anonymous guests cannot init asset uploads (parallel to papers
  // POST and library import — same OR-spend-bypass concern).
  it("403 guest_forbidden for anonymous session", async () => {
    const anon = await createAnonTestUser();
    const r = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: anon.cookie,
        body: JSON.stringify({
          libraryId,
          filename: "fig.png",
          contentType: "image/png",
          sizeBytes: 2048,
        }),
      }),
    );
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toBe("guest_forbidden");
    await deleteTestUser(anon.id);
  });

  it("POST returns presigned uploadUrl + assetId; row stores filename/mime/size", async () => {
    const r = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "diagram.png", sizeBytes: 4096 })),
      }),
    );
    expect(r.status).toBe(201);
    const body = await r.json();
    createdAssetIds.push(body.assetId);
    expect(typeof body.assetId).toBe("string");
    const url = new URL(body.uploadUrl);
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(url.pathname.endsWith(`/assets/${body.assetId}`)).toBe(true);

    const [row] = await db.select().from(assets).where(eq(assets.id, body.assetId));
    expect(row.filename).toBe("diagram.png");
    expect(row.mimeType).toBe("image/png");
    expect(Number(row.sizeBytes)).toBe(4096);
    expect(row.folderId).toBeNull();
    expect(row.libraryId).toBe(libraryId);
    expect(row.userId).toBe(u.id);
  });

  it("GET lists by createdAt desc and respects libraryId", async () => {
    const a = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "a.png" })),
      }),
    );
    const aId = (await a.json()).assetId;
    createdAssetIds.push(aId);

    await new Promise((r) => setTimeout(r, 15));

    const b = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "b.png" })),
      }),
    );
    const bId = (await b.json()).assetId;
    createdAssetIds.push(bId);

    const list = await GET(req(`/api/assets?libraryId=${libraryId}`, { cookie: u.cookie }));
    const rows = await list.json();
    const ids = rows.map((r: any) => r.id);
    const ai = ids.indexOf(aId);
    const bi = ids.indexOf(bId);
    expect(bi).toBeGreaterThanOrEqual(0);
    expect(ai).toBeGreaterThanOrEqual(0);
    expect(bi).toBeLessThan(ai);
  });

  it("GET filters by folderId", async () => {
    const { POST: POST_FOLDER } = await import("../folders/route");
    const folderRes = await POST_FOLDER(
      req("/api/folders", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, parentId: null, name: "AssetTarget" }),
      }),
    );
    const folderId: string = (await folderRes.json()).id;

    const r = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          ...initUpload({ filename: "in-folder.png" }),
          folderId,
        }),
      }),
    );
    const { assetId } = await r.json();
    createdAssetIds.push(assetId);

    const list = await GET(
      req(`/api/assets?libraryId=${libraryId}&folderId=${folderId}`, { cookie: u.cookie }),
    );
    const rows = await list.json();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((a: any) => a.folderId === folderId)).toBe(true);
  });

  it("GET /[id] returns row + presigned downloadUrl", async () => {
    const c = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "dl.png" })),
      }),
    );
    const { assetId } = await c.json();
    createdAssetIds.push(assetId);

    const r = await GET_ID(
      req(`/api/assets/${assetId}`, { cookie: u.cookie }),
      params({ id: assetId }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.id).toBe(assetId);
    const url = new URL(body.downloadUrl);
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(url.pathname.endsWith(`/assets/${assetId}`)).toBe(true);
  });

  it("GET /[id] 403 for other user", async () => {
    const c = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "private.png" })),
      }),
    );
    const { assetId } = await c.json();
    createdAssetIds.push(assetId);

    const r = await GET_ID(
      req(`/api/assets/${assetId}`, { cookie: other.cookie }),
      params({ id: assetId }),
    );
    expect(r.status).toBe(403);
  });

  it("DELETE removes row + best-effort S3 cleanup; subsequent GET 404", async () => {
    const c = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "to-delete.png" })),
      }),
    );
    const { assetId } = await c.json();

    // Upload a tiny payload so deleteObject has something to remove.
    await storage.uploadObject(assetSourceKey(assetId), Buffer.from("x"), "image/png");

    const r = await DEL_ID(
      req(`/api/assets/${assetId}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: assetId }),
    );
    expect(r.status).toBe(204);

    const rows = await db.select().from(assets).where(eq(assets.id, assetId));
    expect(rows.length).toBe(0);

    const after = await GET_ID(
      req(`/api/assets/${assetId}`, { cookie: u.cookie }),
      params({ id: assetId }),
    );
    expect(after.status).toBe(404);
  });

  it("PATCH renames asset", async () => {
    const c = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "old.png" })),
      }),
    );
    const { assetId } = await c.json();
    createdAssetIds.push(assetId);

    const r = await PATCH_ID(
      req(`/api/assets/${assetId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ filename: "new-name.png" }),
      }),
      params({ id: assetId }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.filename).toBe("new-name.png");
  });

  it("PATCH moves asset to owned folder + clears with null", async () => {
    const { POST: POST_FOLDER } = await import("../folders/route");
    const folderRes = await POST_FOLDER(
      req("/api/folders", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, parentId: null, name: "PatchTarget" }),
      }),
    );
    const folderId: string = (await folderRes.json()).id;

    const c = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "movable.png" })),
      }),
    );
    const { assetId } = await c.json();
    createdAssetIds.push(assetId);

    const moved = await PATCH_ID(
      req(`/api/assets/${assetId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ folderId }),
      }),
      params({ id: assetId }),
    );
    expect(moved.status).toBe(200);
    const movedBody = await moved.json();
    expect(movedBody.folderId).toBe(folderId);

    const cleared = await PATCH_ID(
      req(`/api/assets/${assetId}`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ folderId: null }),
      }),
      params({ id: assetId }),
    );
    expect(cleared.status).toBe(200);
    const clearedBody = await cleared.json();
    expect(clearedBody.folderId).toBeNull();
  });

  it("PATCH 404 for missing asset id", async () => {
    const r = await PATCH_ID(
      req(`/api/assets/00000000-0000-0000-0000-000000000000`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ filename: "x.png" }),
      }),
      params({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(r.status).toBe(404);
  });

  it("PATCH 403 for other user", async () => {
    const c = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "hands-off.png" })),
      }),
    );
    const { assetId } = await c.json();
    createdAssetIds.push(assetId);

    const r = await PATCH_ID(
      req(`/api/assets/${assetId}`, {
        method: "PATCH",
        cookie: other.cookie,
        body: JSON.stringify({ filename: "stolen.png" }),
      }),
      params({ id: assetId }),
    );
    expect(r.status).toBe(403);
  });

  it("DELETE 403 for other user", async () => {
    const c = await POST(
      req("/api/assets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(initUpload({ filename: "owned.png" })),
      }),
    );
    const { assetId } = await c.json();
    createdAssetIds.push(assetId);

    const r = await DEL_ID(
      req(`/api/assets/${assetId}`, { method: "DELETE", cookie: other.cookie }),
      params({ id: assetId }),
    );
    expect(r.status).toBe(403);
  });
});
