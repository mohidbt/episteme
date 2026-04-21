import { and, asc, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/crud";

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length === 0) return Response.json({ results: [] });

  const rows = await db
    .select({ id: notes.id, title: notes.title, slug: notes.slug })
    .from(notes)
    .where(and(eq(notes.userId, userId), ilike(notes.title, `%${q}%`)))
    .orderBy(asc(notes.title))
    .limit(10);

  return Response.json({ results: rows });
}
