import { and, asc, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraryReferences } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/crud";

const LIMIT = 20;

type Author = { name: string; authorId?: string };

/**
 * Derive a citekey from the first author's last name + year.
 * Falls back to "ref-<id>" if author/year missing.
 */
function deriveCitekey(
  authors: Author[] | null | undefined,
  year: string | null | undefined,
  id: number,
): string {
  const firstAuthor = authors?.[0]?.name ?? "";
  // "Last, First" or "Last" forms — take the part before first comma
  const lastName = firstAuthor.split(",")[0].trim().toLowerCase().replace(/\s+/g, "");
  if (lastName && year) {
    return `${lastName}${year}`;
  }
  return `ref-${id}`;
}

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length === 0) {
    return Response.json([]);
  }

  const pattern = `%${q}%`;

  // Fetch all user's refs where title matches; author name match is done in JS
  // (avoids JSONB casting complexity while staying correct for the use case).
  const rows = await db
    .select({
      id: libraryReferences.id,
      title: libraryReferences.title,
      authors: libraryReferences.authors,
      year: libraryReferences.year,
      doi: libraryReferences.doi,
    })
    .from(libraryReferences)
    .where(and(eq(libraryReferences.userId, userId), ilike(libraryReferences.title, pattern)))
    .orderBy(asc(libraryReferences.title))
    .limit(LIMIT);

  // Also fetch rows where an author name matches (JS-side filter after a broader fetch)
  // To do this efficiently we fetch user's refs matching title OR try a broader pull:
  // Simple approach: run a second query for author matches and merge.
  const authorRows = await db
    .select({
      id: libraryReferences.id,
      title: libraryReferences.title,
      authors: libraryReferences.authors,
      year: libraryReferences.year,
      doi: libraryReferences.doi,
    })
    .from(libraryReferences)
    .where(eq(libraryReferences.userId, userId))
    .orderBy(asc(libraryReferences.title))
    .limit(200);

  const qLower = q.toLowerCase();
  const authorMatches = authorRows.filter((row) => {
    if (row.title.toLowerCase().includes(qLower)) return false; // already in rows
    const authors = row.authors as Author[] | null;
    if (!authors) return false;
    return authors.some((a) => a.name.toLowerCase().includes(qLower));
  });

  const combined = [...rows, ...authorMatches].slice(0, LIMIT);

  return Response.json(
    combined.map((row) => ({
      id: row.id,
      citekey: deriveCitekey(row.authors as Author[] | null, row.year, row.id),
      title: row.title,
      authors: (row.authors as Author[] | null) ?? [],
      year: row.year ?? null,
      doi: row.doi ?? null,
    })),
  );
}
