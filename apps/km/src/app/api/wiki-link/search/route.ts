import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes, references_, papers, libraries } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/crud";

const LIMIT_PER_KIND = 5;

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length === 0) {
    return Response.json({ notes: [], references: [], papers: [] });
  }
  const pattern = `%${q}%`;

  const [defaultLib] = await db
    .select({ id: libraries.id })
    .from(libraries)
    .where(eq(libraries.userId, userId))
    .orderBy(asc(libraries.id))
    .limit(1);

  const notesRows = await db
    .select({ id: notes.id, title: notes.title, slug: notes.slug })
    .from(notes)
    .where(and(eq(notes.userId, userId), ilike(notes.title, pattern)))
    .orderBy(asc(notes.title))
    .limit(LIMIT_PER_KIND);

  // GSD-32 Phase 1: hide collapsed refs from wiki-link suggestions — only
  // the paper appears.
  const refsRows = defaultLib
    ? await db
        .select({
          id: references_.id,
          citationKey: references_.citationKey,
          cslJson: references_.cslJson,
        })
        .from(references_)
        .where(
          and(
            eq(references_.userId, userId),
            eq(references_.libraryId, defaultLib.id),
            isNull(references_.paperId),
            or(
              ilike(references_.citationKey, pattern),
              sql`${references_.cslJson}->>'title' ILIKE ${pattern}`,
            ),
          ),
        )
        .orderBy(asc(references_.citationKey))
        .limit(LIMIT_PER_KIND)
    : [];

  const papersRows = defaultLib
    ? await db
        .select({
          id: papers.id,
          title: papers.title,
          filename: papers.filename,
        })
        .from(papers)
        .where(
          and(
            eq(papers.userId, userId),
            eq(papers.libraryId, defaultLib.id),
            or(ilike(papers.title, pattern), ilike(papers.filename, pattern)),
          ),
        )
        .orderBy(asc(papers.filename))
        .limit(LIMIT_PER_KIND)
    : [];

  return Response.json({
    notes: notesRows,
    references: refsRows.map((r) => {
      const csl = r.cslJson as { title?: string } | null;
      return {
        id: r.id,
        title: csl?.title ?? r.citationKey,
        citationKey: r.citationKey,
      };
    }),
    papers: papersRows.map((p) => ({
      id: p.id,
      title: p.title ?? p.filename,
    })),
  });
}
