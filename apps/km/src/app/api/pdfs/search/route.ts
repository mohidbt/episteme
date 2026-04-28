import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { jsonError } from "@/lib/crud";

const LIMIT = 20;

export async function GET(req: Request) {
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) { if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured"); throw e; }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length === 0) {
    return Response.json({ results: [] });
  }

  const pattern = `%${q}%`;

  const rows = await db
    .select({
      id: papers.id,
      title: papers.title,
      filename: papers.filename,
      year: papers.year,
      doi: papers.doi,
    })
    .from(papers)
    .where(
      and(
        eq(papers.userId, userId),
        or(ilike(papers.title, pattern), ilike(papers.filename, pattern)),
      ),
    )
    .orderBy(asc(papers.title))
    .limit(LIMIT);

  return Response.json({
    results: rows.map((row) => ({
      id: row.id,
      title: row.title ?? "",
      filename: row.filename,
      year: row.year ?? null,
      doi: row.doi ?? null,
    })),
  });
}
