import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers, paperCitations } from "@episteme/db/schema";

// D7.5: one-shot matcher invoked from POST/PATCH references. User-scoped:
// only ever matches against the caller's own papers. Idempotent via the
// (citer_kind, citer_id, cited_kind, cited_id) UNIQUE constraint + ON CONFLICT.
//
// Algorithm mirrors autoLinkPaperCitations: DOI exact first, then pg_trgm
// title similarity. If pg_trgm or the paper_citations table is absent the
// helpers warn and return as if no match — never throw to the caller.

const FUZZY_SIM_THRESHOLD = 0.6;

export type MatchResult = {
  paperId: string;
  matchMethod: "doi" | "title-fuzzy";
};

export type RefSignals = {
  doi: string | null | undefined;
  title: string | null | undefined;
};

function isPgTrgmMissingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("does not exist") &&
    (msg.includes("operator") || msg.includes("similarity") || msg.includes("pg_trgm"))
  );
}

function isMissingRelationError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("paper_citations") &&
    (msg.includes("does not exist") || msg.includes("relation"))
  );
}

async function findFuzzyTitleHitForUser(
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
        "[match-ref-to-papers] pg_trgm not available; skipping fuzzy title match",
        err instanceof Error ? err.message : err,
      );
      return undefined;
    }
    throw err;
  }
}

export async function matchRefToPapers(
  signals: RefSignals,
  userId: string,
): Promise<MatchResult | null> {
  const { doi, title } = signals;
  if (doi) {
    const hits = (await db
      .select({ id: papers.id })
      .from(papers)
      .where(and(eq(papers.doi, doi), eq(papers.userId, userId)))
      .limit(1)) as Array<{ id: string }>;
    if (hits.length > 0) {
      return { paperId: hits[0].id, matchMethod: "doi" };
    }
  }
  if (title) {
    const hit = await findFuzzyTitleHitForUser(title, userId);
    if (hit) return { paperId: hit.id, matchMethod: "title-fuzzy" };
  }
  return null;
}

export function extractRefSignals(cslJson: unknown): RefSignals {
  if (!cslJson || typeof cslJson !== "object") return { doi: null, title: null };
  const c = cslJson as Record<string, unknown>;
  const doi = typeof c.DOI === "string" && c.DOI.length > 0 ? c.DOI : null;
  const title = typeof c.title === "string" && c.title.length > 0 ? c.title : null;
  return { doi, title };
}

// Try to auto-connect a reference row to one of the user's papers. Writes a
// paper_citations edge on hit. Best-effort: any failure is logged and
// swallowed so the ref write path never fails because of matching.
export async function autoConnectReference(
  refId: string,
  userId: string,
  signals: RefSignals,
): Promise<MatchResult | null> {
  try {
    const match = await matchRefToPapers(signals, userId);
    // Overwrite semantics (plan §3.1): drop any prior ref→paper edges for
    // this ref so an edited DOI/title doesn't leave a stale edge behind.
    await db
      .delete(paperCitations)
      .where(
        and(
          eq(paperCitations.citerKind, "reference"),
          eq(paperCitations.citerId, refId),
          eq(paperCitations.citedKind, "paper"),
        ),
      );
    if (!match) return null;
    await db
      .insert(paperCitations)
      .values({
        citerKind: "reference",
        citerId: refId,
        citedKind: "paper",
        citedId: match.paperId,
        sourceMarkerIdx: null,
        matchMethod: match.matchMethod,
      })
      .onConflictDoNothing();
    return match;
  } catch (err) {
    if (isMissingRelationError(err)) {
      console.warn("[match-ref-to-papers] paper_citations missing, skipping", err);
      return null;
    }
    console.warn("[match-ref-to-papers] auto-connect failed for ref", refId, err);
    return null;
  }
}
