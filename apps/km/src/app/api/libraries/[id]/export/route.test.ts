import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "./route";
import { POST as POST_LIB } from "../../route";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../../../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;
let libName: string;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  libName = "Export Lib";
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: libName }),
    }),
  );
  libraryId = (await r.json()).id;

  await db.insert(notes).values({
    libraryId,
    userId: u.id,
    folderPath: "",
    slug: "route-export-note",
    title: "Route Export Note",
    contentMd: "body",
  });
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("GET /api/libraries/:id/export", () => {
  it("401 no user", async () => {
    const r = await GET(
      req(`/api/libraries/${libraryId}/export`),
      params({ id: String(libraryId) }),
    );
    expect(r.status).toBe(401);
  });

  it("400 non-numeric id", async () => {
    const r = await GET(
      req(`/api/libraries/abc/export`, { cookie: u.cookie }),
      params({ id: "abc" }),
    );
    expect(r.status).toBe(400);
  });

  it("403 foreign library", async () => {
    const r = await GET(
      req(`/api/libraries/${libraryId}/export`, { cookie: other.cookie }),
      params({ id: String(libraryId) }),
    );
    expect(r.status).toBe(403);
  });

  it("200 returns a zip with proper headers and magic bytes", async () => {
    const r = await GET(
      req(`/api/libraries/${libraryId}/export`, { cookie: u.cookie }),
      params({ id: String(libraryId) }),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/zip");
    expect(r.headers.get("content-disposition")).toBe(
      `attachment; filename="${libName}.zip"`,
    );
    const buf = Buffer.from(await r.arrayBuffer());
    // ZIP local file header magic: PK\x03\x04
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  }, 30_000);
});
