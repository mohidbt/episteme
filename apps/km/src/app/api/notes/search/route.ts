import { and, asc, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { getAuthedUserId } from "@/lib/internal-auth";
import { jsonError } from "@/lib/crud";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function GET(req: Request) {
  const userId = await getAuthedUserId(req);
  if (!userId) return jsonError(401, "unauthorized");

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length === 0) return Response.json({ results: [] });

  const kRaw = Number(url.searchParams.get("k"));
  const limit = Number.isFinite(kRaw) && kRaw > 0
    ? Math.min(Math.floor(kRaw), MAX_LIMIT)
    : DEFAULT_LIMIT;

  // TODO(1.4): swap ilike title match for pgvector semantic search
  const rows = await db
    .select({ id: notes.id, title: notes.title, slug: notes.slug })
    .from(notes)
    .where(and(eq(notes.userId, userId), ilike(notes.title, `%${q}%`)))
    .orderBy(asc(notes.title))
    .limit(limit);

  return Response.json({ results: rows });
}
