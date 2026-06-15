import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "./route";
import { POST as setUsername } from "../../../users/username/route";
import {
  createTestUser,
  deleteTestUser,
  req,
  type TestUser,
} from "../../../_test-utils";

let owner: TestUser;
const rand = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  owner = await createTestUser();
});

afterAll(async () => {
  await deleteTestUser(owner.id);
});

function call(u: string | null) {
  const qs = u === null ? "" : `?u=${encodeURIComponent(u)}`;
  return GET(req(`/api/auth/username/available${qs}`));
}

describe("GET /api/auth/username/available", () => {
  it("returns available:true for a well-formed free username", async () => {
    const r = await call(`avail-${rand()}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ available: true });
  });

  it("returns reason 'reserved' for reserved words", async () => {
    const r = await call("app");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ available: false, reason: "reserved" });
  });

  it("returns reason 'invalid' for malformed inputs", async () => {
    for (const bad of ["ab", "Mohid", "foo_bar", "a".repeat(31)]) {
      const r = await call(bad);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ available: false, reason: "invalid" });
    }
  });

  it("returns reason 'invalid' when u is missing or empty", async () => {
    for (const v of [null, ""]) {
      const r = await call(v);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ available: false, reason: "invalid" });
    }
  });

  it("returns reason 'taken' for a username already in the DB", async () => {
    const name = `taken-${rand()}`;
    const claim = await setUsername(
      req("/api/users/username", {
        method: "POST",
        cookie: owner.cookie,
        body: JSON.stringify({ username: name }),
      }),
    );
    expect(claim.status).toBe(200);

    const r = await call(name);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ available: false, reason: "taken" });
  });
});
