import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@episteme/db/schema";
import { auth } from "@episteme/auth";

export function makeUserId(prefix = "u"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export interface TestUser {
  id: string;
  cookie: string;
}

export async function createTestUser(): Promise<TestUser> {
  const tag = makeUserId();
  const email = `${tag}@test.local`;
  const password = "test-password-1234";

  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password, name: "Test User" },
    returnHeaders: true,
  });

  const setCookie = headers.get("set-cookie");
  if (!setCookie) throw new Error("signUpEmail returned no set-cookie header");
  // set-cookie format: "name=value; Path=/; ..." — we only need "name=value"
  const cookie = setCookie.split(";")[0];

  const id = (response as { user: { id: string } }).user.id;
  return { id, cookie };
}

export async function deleteTestUser(id: string): Promise<void> {
  await db.delete(user).where(eq(user.id, id));
}

export function req(
  url: string,
  init: RequestInit & { cookie?: string } = {},
): Request {
  const { cookie, headers, ...rest } = init;
  const hdrs = new Headers(headers);
  if (cookie) hdrs.set("cookie", cookie);
  if (init.body && !hdrs.has("content-type")) hdrs.set("content-type", "application/json");
  return new Request(`http://localhost${url}`, { ...rest, headers: hdrs });
}

export function params<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) };
}
