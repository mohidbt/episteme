import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST as POST_LIB } from "@/app/api/libraries/route";
import { POST as POST_PAPERSET } from "@/app/api/papersets/route";
import { createTestUser, deleteTestUser, params, req, type TestUser } from "@/app/api/_test-utils";
import { db } from "@/lib/db";
import { papersets } from "@episteme/db/schema";
import { GET } from "./route";

let u: TestUser;
let other: TestUser;
let libraryId: number;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();

  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Paperset File Route Lib" }),
    }),
  );
  libraryId = (await r.json()).id as number;
}, 60_000);

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

async function seedPaperset(filename = "sample.csv", content = "a,b\n1,2\n"): Promise<string> {
  const r = await POST_PAPERSET(
    req("/api/papersets", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({
        filename,
        columns: [{ name: "a", description: "col a" }],
      }),
    }),
  );
  if (r.status !== 201) throw new Error(`seed paperset failed: ${r.status}`);
  const id = (await r.json()).id as string;
  await db.update(papersets).set({ content }).where(eq(papersets.id, id));
  return id;
}

describe("GET /api/papersets/:id/file", () => {
  it("401 when unauthenticated", async () => {
    const id = await seedPaperset();
    const r = await GET(req(`/api/papersets/${id}/file`), params({ id }));
    expect(r.status).toBe(401);
  });

  it("403 on cross-user access", async () => {
    const id = await seedPaperset();
    const r = await GET(req(`/api/papersets/${id}/file`, { cookie: other.cookie }), params({ id }));
    expect(r.status).toBe(403);
  });

  it("404 when paperset missing", async () => {
    const fake = "00000000-0000-0000-0000-000000000000";
    const r = await GET(req(`/api/papersets/${fake}/file`, { cookie: u.cookie }), params({ id: fake }));
    expect(r.status).toBe(404);
  });

  it("200 returns csv attachment for owner", async () => {
    const id = await seedPaperset("bench", "x,y\n3,4\n");
    const r = await GET(req(`/api/papersets/${id}/file`, { cookie: u.cookie }), params({ id }));
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/csv");
    expect(r.headers.get("Content-Disposition")).toContain('attachment; filename="bench.csv"');
    await expect(r.text()).resolves.toBe("x,y\n3,4\n");
  });
});
