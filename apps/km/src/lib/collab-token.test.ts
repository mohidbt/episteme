import { describe, it, expect, beforeAll } from "vitest";
import { decodeJwt } from "jose";
import { mintCollabToken } from "./collab-token";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long!!";
});

describe("mintCollabToken", () => {
  it("returns a 3-part JWT string", async () => {
    const token = await mintCollabToken("user-abc");
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });

  it("payload contains correct userId", async () => {
    const token = await mintCollabToken("user-xyz");
    const payload = decodeJwt(token);
    expect(payload.userId).toBe("user-xyz");
    expect(payload.iss).toBe("episteme-km");
    expect(payload.aud).toBe("episteme-sync");
  });

  it("token expires ~10 minutes from now", async () => {
    const token = await mintCollabToken("user-abc");
    const payload = decodeJwt(token);
    const now = Math.floor(Date.now() / 1000);
    const tenMinutes = 10 * 60;
    expect(payload.exp).toBeGreaterThan(now + tenMinutes - 30);
    expect(payload.exp).toBeLessThan(now + tenMinutes + 30);
  });

  it("mints different tokens for different userIds", async () => {
    const t1 = await mintCollabToken("user-1");
    const t2 = await mintCollabToken("user-2");
    expect(decodeJwt(t1).userId).toBe("user-1");
    expect(decodeJwt(t2).userId).toBe("user-2");
    expect(t1).not.toBe(t2);
  });
});
