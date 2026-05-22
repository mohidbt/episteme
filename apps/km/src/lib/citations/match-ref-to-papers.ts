import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentReferences, papers, paperCitations } from "@episteme/db/schema";

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

// Locate document_references rows in the user's papers that "incarnate" this
// library reference — same DOI (case-insensitive, whitespace-tolerant) or, if
// no DOI, the same fuzzy title via pg_trgm above FUZZY_SIM_THRESHOLD. Used by
// autoConnectReference to pick the int citer_id under the Symmetry contract
// (Task #57): paper_citations.citer_id for citer_kind='reference' MUST be
// String(document_references.id), matching the cited-side convention in
// auto-link.ts. pg_trgm missing → fuzzy path degrades to no hit.
async function findUserDocRefsForSignals(
  userId: string,
  signals: RefSignals,
): Promise<number[]> {
  const { doi, title } = signals;
  if (doi) {
    const rows = await db
      .select({ id: documentReferences.id })
      .from(documentReferences)
      .innerJoin(papers, eq(papers.id, documentReferences.paperId))
      .where(
        and(
          eq(papers.userId, userId),
          eq(sql`lower(trim(${documentReferences.doi}))`, doi.toLowerCase().trim()),
        ),
      );
    return rows.map((r) => r.id);
  }
  if (title) {
    try {
      const result = await db.execute(sql`
        SELECT dr.id
        FROM document_references dr
        INNER JOIN papers p ON p.id = dr.paper_id
        WHERE p.user_id = ${userId}
          AND dr.title IS NOT NULL
          AND dr.title % ${title}
          AND similarity(dr.title, ${title}) >= ${FUZZY_SIM_THRESHOLD}
      `);
      const rows = (result as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
      const list = Array.isArray(rows) ? rows : [];
      return list
        .map((r) => (r as { id?: number | string }).id)
        .filter((v): v is number | string => v != null)
        .map((v) => (typeof v === "string" ? parseInt(v, 10) : v))
        .filter((n) => Number.isFinite(n));
    } catch (err) {
      if (isPgTrgmMissingError(err)) {
        console.warn(
          "[match-ref-to-papers] pg_trgm missing; skipping fuzzy docRef lookup",
          err instanceof Error ? err.message : err,
        );
        return [];
      }
      throw err;
    }
  }
  return [];
}

// Try to auto-connect a library reference (references_.id, UUID) to one of
// the user's papers. Best-effort: any failure is logged and swallowed so the
// ref write path never fails because of matching.
//
// Task #57 — Symmetry contract: under citer_kind='reference', citer_id must
// be String(document_references.id) — same convention as cited_kind='reference'
// edges from auto-link.ts. Therefore autoConnectReference resolves the library
// reference to its document_references incarnations (DOI/title) in the user's
// papers and emits one edge per incarnation. If no incarnation exists yet
// (e.g. no extracted bib has the matching DOI), no edge is written — the
// edge will materialise once a paper extract produces the docRef.
//
// Overwrite semantics: prior edges for any matching docRef (citer_id in the
// resolved int set) AND the legacy UUID-keyed citer_id are dropped first so
// an edited DOI/title doesn't leave a stale edge, and pre-Symmetry UUID rows
// get cleaned up on the next edit.
export async function autoConnectReference(
  refId: string,
  userId: string,
  signals: RefSignals,
): Promise<MatchResult | null> {
  try {
    const [match, docRefIds] = await Promise.all([
      matchRefToPapers(signals, userId),
      findUserDocRefsForSignals(userId, signals),
    ]);
    const docRefIdStrings = docRefIds.map((n) => String(n));
    // Overwrite: clear prior edges for these docRef ids AND the legacy
    // UUID-keyed row (pre-#57 writes; cleaned up on next edit).
    const staleCiterIds = [refId, ...docRefIdStrings];
    if (staleCiterIds.length > 0) {
      await db
        .delete(paperCitations)
        .where(
          and(
            eq(paperCitations.citerKind, "reference"),
            inArray(paperCitations.citerId, staleCiterIds),
            eq(paperCitations.citedKind, "paper"),
          ),
        );
    }
    if (!match) return null;
    if (docRefIdStrings.length === 0) {
      // No docRef incarnation yet — defer. Edge will be written once a paper
      // extract produces a document_references row with the matching DOI/title.
      return match;
    }
    await db
      .insert(paperCitations)
      .values(
        docRefIdStrings.map((citerId) => ({
          citerKind: "reference" as const,
          citerId,
          citedKind: "paper" as const,
          citedId: match.paperId,
          sourceMarkerIdx: null,
          matchMethod: match.matchMethod,
        })),
      )
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
