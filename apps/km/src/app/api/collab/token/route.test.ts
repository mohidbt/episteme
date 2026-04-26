import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeJwt } from "jose";
import { POST } from "./route";
import {
  createTestUser,
  deleteTestUser,
  req,
  type TestUser,
} from "../../_test-utils";

let u: TestUser;

beforeAll(async () => {
  u = await createTestUser();
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("POST /api/collab/token", () => {
  it("returns 401 when no session cookie is present", async () => {
    const r = await POST(req("/api/collab/token", { method: "POST" }));
    expect(r.status).toBe(401);
  });

  it("returns 200 with a JWT when session is valid", async () => {
    const r = await POST(req("/api/collab/token", { method: "POST", cookie: u.cookie }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(typeof body.token).toBe("string");
    expect(body.token.split(".").length).toBe(3); // JWT has 3 parts
  });

  it("JWT payload contains userId === session.user.id and exp ~10 min in future", async () => {
    const r = await POST(req("/api/collab/token", { method: "POST", cookie: u.cookie }));
    expect(r.status).toBe(200);
    const { token } = await r.json();
    const payload = decodeJwt(token);

    expect(payload.userId).toBe(u.id);

    const now = Math.floor(Date.now() / 1000);
    const tenMinutes = 10 * 60;
    // exp should be ~10 minutes from now (allow ±30s slop)
    expect(payload.exp).toBeGreaterThan(now + tenMinutes - 30);
    expect(payload.exp).toBeLessThan(now + tenMinutes + 30);
  });
});
