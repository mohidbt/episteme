import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET, PATCH } from "./route";
import { db } from "@/lib/db";
import { userPreferences } from "@episteme/db/schema";
import {
  createTestUser,
  deleteTestUser,
  req,
  type TestUser,
} from "../_test-utils";

let u: TestUser;
let fresh: TestUser;

beforeAll(async () => {
  u = await createTestUser();
  fresh = await createTestUser();
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(fresh.id);
});

describe("GET /api/preferences", () => {
  it("401 no user", async () => {
    const r = await GET(req("/api/preferences"));
    expect(r.status).toBe(401);
  });

  it("returns defaults for user with no row (does not insert)", async () => {
    const r = await GET(req("/api/preferences", { cookie: fresh.cookie }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ font: "sans", ruledLines: false });

    const rows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, fresh.id));
    expect(rows.length).toBe(0);
  });
});

describe("PATCH /api/preferences", () => {
  it("401 no user", async () => {
    const r = await PATCH(
      req("/api/preferences", {
        method: "PATCH",
        body: JSON.stringify({ font: "serif" }),
      }),
    );
    expect(r.status).toBe(401);
  });

  it("400 on invalid font", async () => {
    const r = await PATCH(
      req("/api/preferences", {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ font: "comic" }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("upserts and returns merged row; second PATCH updates in place", async () => {
    const r1 = await PATCH(
      req("/api/preferences", {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ font: "serif", ruledLines: true }),
      }),
    );
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.font).toBe("serif");
    expect(b1.ruledLines).toBe(true);

    const r2 = await PATCH(
      req("/api/preferences", {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ font: "mono" }),
      }),
    );
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    expect(b2.font).toBe("mono");
    expect(b2.ruledLines).toBe(true); // preserved

    // Still only one row.
    const rows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, u.id));
    expect(rows.length).toBe(1);
  });
});
