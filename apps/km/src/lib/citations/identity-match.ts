import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers, references_ } from "@episteme/db/schema";

// H-batch Step 6: identity match between a library reference and a library
// paper. Returns the user's paper that is the *same entity* as the given
// reference, by DOI exact (case/whitespace tolerant) OR pg_trgm title fuzzy
// ≥ FUZZY_SIM_THRESHOLD. Mirrors edgesPaperIsRef in lib/graph/live-edges.ts.
//
// pg_trgm-missing degrades to DOI-only (matches auto-link.ts behaviour).

// Must mirror the threshold used by edgesPaperIsRef so the badge's presence
// agrees with the graph edge — drift here would yield "edge but no badge" or
// vice-versa.
const FUZZY_SIM_THRESHOLD = 0.6;

function isPgTrgmMissingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const causeMsg = err.cause instanceof Error ? err.cause.message : "";
  const msg = `${err.message} ${causeMsg}`.toLowerCase();
  return (
    msg.includes("does not exist") &&
    (msg.includes("operator") || msg.includes("similarity") || msg.includes("pg_trgm"))
  );
}

export interface IdentityPaperHit {
  paperId: string;
  title: string | null;
}

export async function findIdentityPaperForReference(
  referenceId: string,
  userId: string,
): Promise<IdentityPaperHit | null> {
  // 1. Load reference scoped to user — cross-user isolation.
  const refRows = await db
    .select({ cslJson: references_.cslJson, paperId: references_.paperId })
    .from(references_)
    .where(and(eq(references_.id, referenceId), eq(references_.userId, userId)))
    .limit(1);

  if (refRows.length === 0) return null;

  // O2: explicit manual attach overrides DOI/title derivation. references_.paperId
  // is set by attachReferenceToPaper / cleared by detachReferenceFromPaper.
  // We still scope by userId on the paper lookup so a stale pointer to a
  // deleted or transferred paper degrades to no badge instead of leaking.
  const explicitPaperId = refRows[0].paperId;
  if (explicitPaperId) {
    const paperRows = await db
      .select({ id: papers.id, title: papers.title })
      .from(papers)
      .where(and(eq(papers.id, explicitPaperId), eq(papers.userId, userId)))
      .limit(1);
    const p = paperRows[0];
    if (p) return { paperId: p.id, title: p.title ?? null };
    // Stale pointer (paper deleted / cross-user). Fall through to derivation
    // so the badge isn't silently wrong if DOI/title still agree elsewhere.
  }

  const csl = (refRows[0].cslJson ?? {}) as Record<string, unknown>;
  const doi = typeof csl.DOI === "string" ? csl.DOI.trim() : null;
  const title = typeof csl.title === "string" ? csl.title.trim() : null;

  // 2. DOI exact match (preferred).
  if (doi) {
    const hits = await db.execute(sql`
      SELECT id, title
      FROM papers
      WHERE user_id = ${userId}
        AND doi IS NOT NULL
        AND lower(trim(doi)) = ${doi.toLowerCase()}
      LIMIT 1
    `);
    const rowsRaw = (hits as { rows?: unknown[] }).rows ?? (hits as unknown as unknown[]);
    const list = Array.isArray(rowsRaw) ? rowsRaw : [];
    const top = list[0] as { id?: string; title?: string | null } | undefined;
    if (top?.id) return { paperId: top.id, title: top.title ?? null };
  }

  // 3. Title fuzzy fallback — only when DOI miss/absent.
  if (title) {
    try {
      const hits = await db.execute(sql`
        SELECT id, title, similarity(title, ${title}) AS sim
        FROM papers
        WHERE user_id = ${userId}
          AND title IS NOT NULL
          AND title % ${title}
          AND similarity(title, ${title}) >= ${FUZZY_SIM_THRESHOLD}
        ORDER BY sim DESC
        LIMIT 1
      `);
      const rowsRaw = (hits as { rows?: unknown[] }).rows ?? (hits as unknown as unknown[]);
      const list = Array.isArray(rowsRaw) ? rowsRaw : [];
      const top = list[0] as { id?: string; title?: string | null } | undefined;
      if (top?.id) return { paperId: top.id, title: top.title ?? null };
    } catch (err) {
      if (isPgTrgmMissingError(err)) {
        console.warn(
          "[identity-match] pg_trgm not available; skipping fuzzy title match",
          err instanceof Error ? err.message : err,
        );
        return null;
      }
      throw err;
    }
  }

  return null;
}
