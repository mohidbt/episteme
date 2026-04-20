import { eq, and, ne } from "drizzle-orm";
import { db } from "./db";
import { toSlug } from "./slug";
import { notes } from "@episteme/db/schema";

type Owned = { id: unknown; userId: string };

export type OwnershipResult<T> =
  | { ok: true; row: T }
  | { ok: false; status: 404 | 403 };

export async function requireOwned<T extends Owned>(
  table: any,
  id: string | number,
  userId: string,
): Promise<OwnershipResult<T>> {
  const rows = await db.select().from(table).where(eq(table.id, id as any)).limit(1);
  const row = rows[0] as T | undefined;
  if (!row) return { ok: false, status: 404 };
  if (row.userId !== userId) return { ok: false, status: 403 };
  return { ok: true, row };
}

export async function resolveNoteSlug(
  userId: string,
  title: string,
  excludeNoteId?: string,
): Promise<string> {
  const base = toSlug(title);
  for (let i = 1; i < 500; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const where = excludeNoteId
      ? and(eq(notes.userId, userId), eq(notes.slug, candidate), ne(notes.id, excludeNoteId))
      : and(eq(notes.userId, userId), eq(notes.slug, candidate));
    const existing = await db.select({ id: notes.id }).from(notes).where(where).limit(1);
    if (existing.length === 0) return candidate;
  }
  throw new Error("slug_exhausted");
}

export function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
) {
  return Response.json({ error, ...(extra ?? {}) }, { status });
}
