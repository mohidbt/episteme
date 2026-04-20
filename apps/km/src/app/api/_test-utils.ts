import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@episteme/db/schema";

export function makeUserId(prefix = "u"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export async function createTestUser(id?: string): Promise<string> {
  const uid = id ?? makeUserId();
  await db.insert(user).values({
    id: uid,
    name: "Test User",
    email: `${uid}@test.local`,
    emailVerified: false,
  });
  return uid;
}

export async function deleteTestUser(id: string): Promise<void> {
  await db.delete(user).where(eq(user.id, id));
}

export function req(
  url: string,
  init: RequestInit & { userId?: string } = {},
): Request {
  const { userId, headers, ...rest } = init;
  const hdrs = new Headers(headers);
  if (userId) hdrs.set("x-user-id", userId);
  if (init.body && !hdrs.has("content-type")) hdrs.set("content-type", "application/json");
  return new Request(`http://localhost${url}`, { ...rest, headers: hdrs });
}

export function params<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) };
}
