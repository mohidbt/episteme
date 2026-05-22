import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documentReferences,
  papers,
  paperCitations,
} from "@episteme/db/schema";

// D2: auto-link paper_citations rows from document_references after extract.
//
// For each documentReferences row tied to `paperId`:
//   1. If ref.doi → exact match against papers.doi; on hit → edge to that
//      paper with match_method='doi'.
//   2. Else if ref.title → fuzzy match against papers.title via pg_trgm
//      similarity (index: idx_papers_title_trgm, migration 0039); on hit
//      above FUZZY_SIM_THRESHOLD → match_method='title-fuzzy'.
//   3. Otherwise edge to the reference itself (cited_kind='reference').
//
// Idempotent via the (citer_kind,citer_id,cited_kind,cited_id) UNIQUE index
// + ON CONFLICT DO NOTHING. Insert errors mentioning the table not existing
// degrade to {linked:0} so the caller doesn't fail when migration lags
// behind code deploy. pg_trgm operator-missing errors (extension not yet
// installed) degrade silently to "no fuzzy hit" so the per-ref edge still
// gets recorded.

export interface AutoLinkResult {
  linked: number;
}

// Minimum trigram similarity to accept as a title-fuzzy match. Tuned for
// title strings — 0.6 is the empirical threshold where common short-title
// false positives drop out while paraphrase/punctuation variants still pass.
const FUZZY_SIM_THRESHOLD = 0.6;

function isMissingRelationError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("paper_citations") &&
    (msg.includes("does not exist") || msg.includes("relation"))
  );
}

function isPgTrgmMissingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // PG raises "operator does not exist: text % text" when pg_trgm is absent.
  // Also defensive on the function form "function similarity(...) does not
  // exist" in case the operator was registered but the function wasn't.
  return (
    msg.includes("does not exist") &&
    (msg.includes("operator") || msg.includes("similarity") || msg.includes("pg_trgm"))
  );
}

async function findFuzzyTitleHit(
  rawTitle: string,
  userId: string,
): Promise<{ id: string; sim: number } | undefined> {
  try {
    const result = await db.execute(sql`
      SELECT id, similarity(title, ${rawTitle}) AS sim
      FROM papers
      WHERE user_id = ${userId} AND title % ${rawTitle}
      ORDER BY sim DESC
      LIMIT 5
    `);
    // drizzle-orm's pg execute() returns { rows: [...] } shape (node-postgres
    // and neon serverless both wrap this way). Defensive fallback to array.
    const rows = (result as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
    const list = Array.isArray(rows) ? rows : [];
    const top = list[0] as { id?: string; sim?: number | string } | undefined;
    if (!top || top.id == null || top.sim == null) return undefined;
    const sim = typeof top.sim === "string" ? parseFloat(top.sim) : top.sim;
    if (!Number.isFinite(sim) || sim < FUZZY_SIM_THRESHOLD) return undefined;
    return { id: String(top.id), sim };
  } catch (err) {
    if (isPgTrgmMissingError(err)) {
      console.warn(
        "[auto-link] pg_trgm not available; skipping fuzzy title match",
        err instanceof Error ? err.message : err,
      );
      return undefined;
    }
    throw err;
  }
}

export async function autoLinkPaperCitations(
  paperId: string,
): Promise<AutoLinkResult> {
  // Scope all DOI/title lookups to the owning user — auto-link must never
  // cross tenants. Originally unscoped; tenanted hosts were OK in prod but
  // shared dev DBs leaked edges across users.
  const ownerRows = (await db
    .select({ userId: papers.userId })
    .from(papers)
    .where(eq(papers.id, paperId))
    .limit(1)) as Array<{ userId: string }>;
  const userId = ownerRows[0]?.userId;
  if (!userId) return { linked: 0, matched: 0 };

  const refs = await db
    .select({
      id: documentReferences.id,
      paperId: documentReferences.paperId,
      doi: documentReferences.doi,
      title: documentReferences.title,
      markerIndex: documentReferences.markerIndex,
    })
    .from(documentReferences)
    .where(eq(documentReferences.paperId, paperId));

  let linked = 0;

  for (const ref of refs) {
    let citedKind: "paper" | "reference" = "reference";
    let citedId: string = String(ref.id);
    let matchMethod: "doi" | "title-fuzzy" | "manual" = "manual";

    if (ref.doi) {
      const hits = (await db
        .select({ id: papers.id })
        .from(papers)
        .where(and(eq(papers.doi, ref.doi), eq(papers.userId, userId)))
        .limit(1)) as Array<{ id: string }>;
      if (hits.length > 0) {
        citedKind = "paper";
        citedId = hits[0].id;
        matchMethod = "doi";
      } else {
        citedKind = "reference";
        citedId = String(ref.id);
        matchMethod = "manual";
      }
    } else if (ref.title) {
      const hit = await findFuzzyTitleHit(ref.title, userId);
      if (hit) {
        citedKind = "paper";
        citedId = hit.id;
        matchMethod = "title-fuzzy";
      } else {
        citedKind = "reference";
        citedId = String(ref.id);
        matchMethod = "manual";
      }
    }

    // If we ended on reference fallback, choose a non-'manual' provenance —
    // 'manual' is reserved for user-edited rows. Use the original signal.
    if (citedKind === "reference") {
      matchMethod = ref.doi ? "doi" : ref.title ? "title-fuzzy" : "manual";
    }

    try {
      const inserted = await db
        .insert(paperCitations)
        .values({
          citerKind: "paper",
          citerId: paperId,
          citedKind,
          citedId,
          sourceMarkerIdx: ref.markerIndex ?? null,
          matchMethod,
        })
        .onConflictDoNothing()
        .returning({ id: paperCitations.id });
      linked += inserted.length;
    } catch (err) {
      if (isMissingRelationError(err)) {
        console.warn(
          "[auto-link] paper_citations table missing, skipping",
          err,
        );
        return { linked: 0 };
      }
      console.warn("[auto-link] insert failed for ref", ref.id, err);
    }
  }

  return { linked };
}
