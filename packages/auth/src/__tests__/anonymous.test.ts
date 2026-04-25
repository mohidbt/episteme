import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "../../../../apps/reader/.env.local") });

describe("better-auth anonymous plugin", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set — load apps/reader/.env.local");
    }
  });

  it("signInAnonymous creates an anonymous user and returns a session cookie", async () => {
    const { auth } = await import("../server");

    const response = await auth.api.signInAnonymous({
      returnHeaders: true,
    });

    expect(response).toBeDefined();
    expect(response.response.user).toBeDefined();
    expect(response.response.user.id).toBeTruthy();

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/better-auth\.session_token/);
  });

  it("getSession returns a user with isAnonymous: true", async () => {
    const { auth } = await import("../server");

    const signIn = await auth.api.signInAnonymous({ returnHeaders: true });
    const cookie = signIn.headers.get("set-cookie") ?? "";

    const headers = new Headers();
    headers.set("cookie", cookie);

    const session = await auth.api.getSession({ headers });
    expect(session).toBeTruthy();
    expect(session?.user.isAnonymous).toBe(true);
  });
});
