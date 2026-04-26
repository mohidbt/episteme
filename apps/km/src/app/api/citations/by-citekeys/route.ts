import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraryReferences } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/crud";

const MAX_CITEKEYS = 200;

type Author = { name: string; authorId?: string };

/**
 * Derive a citekey from the first author's last name + year.
 * Must match the derivation in the search route.
 */
function deriveCitekey(
  authors: Author[] | null | undefined,
  year: string | null | undefined,
  id: number,
): string {
  const firstAuthor = authors?.[0]?.name ?? "";
  const lastName = firstAuthor.split(",")[0].trim().toLowerCase().replace(/\s+/g, "");
  if (lastName && year) {
    return `${lastName}${year}`;
  }
  return `ref-${id}`;
}

/**
 * POST /api/citations/by-citekeys
 *
 * Body: { citekeys: string[] }  (capped at 200; extras ignored)
 *
 * Returns: { results: { citekey, title, authors: string[], year, doi }[] }
 * Only citekeys that match the user's library are returned.
 * Missing citekeys are silently absent.
 */
export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");

  let body: { citekeys?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }

  const rawKeys = body?.citekeys;
  if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
    return Response.json({ results: [] });
  }

  const requestedKeys = new Set<string>(
    (rawKeys as unknown[])
      .slice(0, MAX_CITEKEYS)
      .filter((k): k is string => typeof k === "string"),
  );

  if (requestedKeys.size === 0) {
    return Response.json({ results: [] });
  }

  // Fetch all refs for this user, then filter by derived citekey in JS.
  // This avoids complex JSONB queries while being correct for the use case.
  const rows = await db
    .select({
      id: libraryReferences.id,
      title: libraryReferences.title,
      authors: libraryReferences.authors,
      year: libraryReferences.year,
      doi: libraryReferences.doi,
    })
    .from(libraryReferences)
    .where(eq(libraryReferences.userId, userId));

  const results = rows
    .filter((row) => {
      const ck = deriveCitekey(row.authors as Author[] | null, row.year, row.id);
      return requestedKeys.has(ck);
    })
    .map((row) => ({
      citekey: deriveCitekey(row.authors as Author[] | null, row.year, row.id),
      title: row.title,
      // authors as string[] (name only)
      authors: ((row.authors as Author[] | null) ?? []).map((a) => a.name),
      year: row.year ?? null,
      doi: row.doi ?? null,
    }));

  return Response.json({ results });
}
