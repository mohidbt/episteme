import { and, asc, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers, papersets, references_ } from "@episteme/db/schema";

export type GuestTourTargets = {
  welcomeNoteHref: string;
  referenceHref: string | null;
  paperHref: string | null;
  paperReaderHref: string | null;
  papersetHref: string | null;
};

/**
 * Resolve hrefs for guest-tour "open X" navigation steps from the user's
 * seeded library. Returns nulls for any record that hasn't seeded yet — the
 * tour skips that step's navigation rather than dead-end.
 *
 * - Welcome note: slug is deterministic, no DB lookup.
 * - Reference: first library_references row (seed order = alphafold first).
 * - Paper: "Spontaneous switching…" PSM survey paper, title-matched.
 * - Paperset: psm-survey.csv (seed filename).
 */
export async function getGuestTourTargets(userId: string): Promise<GuestTourTargets> {
  const [ref, paper, set] = await Promise.all([
    db
      .select({ id: references_.id })
      .from(references_)
      .where(eq(references_.userId, userId))
      .orderBy(asc(references_.createdAt))
      .limit(1),
    db
      .select({ id: papers.id })
      .from(papers)
      .where(and(eq(papers.userId, userId), ilike(papers.title, "Spontaneous switching%")))
      .limit(1),
    db
      .select({ id: papersets.id })
      .from(papersets)
      .where(and(eq(papersets.userId, userId), eq(papersets.filename, "psm-survey.csv")))
      .limit(1),
  ]);
  const paperId = paper[0]?.id ?? null;
  return {
    welcomeNoteHref: "/n/welcome-to-episteme",
    referenceHref: ref[0] ? `/r/${ref[0].id}` : null,
    paperHref: paperId ? `/p/${paperId}` : null,
    paperReaderHref: paperId ? `/papers/${paperId}/read` : null,
    papersetHref: set[0] ? `/d/${set[0].id}` : null,
  };
}
