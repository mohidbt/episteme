import { describe, it, expect, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@episteme/db";
import { user as userTable } from "@episteme/db/schema";
import { auth } from "../server";

const createdUserIds: string[] = [];

afterAll(async () => {
  if (createdUserIds.length > 0) {
    // session and account FKs use onDelete: "cascade" (see packages/db/src/schema/auth.ts)
    await db.delete(userTable).where(inArray(userTable.id, createdUserIds));
  }
});

describe("better-auth anonymous plugin", () => {
  it("signInAnonymous creates an anonymous user, returns a session cookie, and getSession reports isAnonymous", async () => {
    const signIn = await auth.api.signInAnonymous({ returnHeaders: true });

    expect(signIn).toBeDefined();
    expect(signIn.response.user).toBeDefined();
    expect(signIn.response.user.id).toBeTruthy();
    createdUserIds.push(signIn.response.user.id);

    const setCookie = signIn.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/better-auth\.session_token/);

    const headers = new Headers();
    headers.set("cookie", setCookie ?? "");

    const session = await auth.api.getSession({ headers });
    expect(session).toBeTruthy();
    expect(session?.user.isAnonymous).toBe(true);
  });
});
