import { and, asc, count, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  citationEnrichmentJobs,
  documentReferences,
  papers,
} from "@episteme/db/schema";
import { enrichReferenceBatchInDb } from "@/lib/citations/enrich-paper";
import { SemanticScholarRateLimitError } from "@/lib/citations/semantic-scholar";

const BATCH_SIZE = 5;
const LOCK_MS = 2 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MS = 10 * 60 * 1000;
const ERROR_BACKOFF_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;

type JobRow = typeof citationEnrichmentJobs.$inferSelect;

export type CitationEnrichmentStatus = {
  status: "idle" | JobRow["status"];
  totalUnenriched: number;
  nextRunAt: string | null;
  lastError: string | null;
};

async function getReferenceCounts(paperId: string): Promise<{
  totalRefs: number;
  totalUnenriched: number;
}> {
  const [totalRow] = await db
    .select({ n: count() })
    .from(documentReferences)
    .where(eq(documentReferences.paperId, paperId));
  const [unenrichedRow] = await db
    .select({ n: count() })
    .from(documentReferences)
    .where(
      and(
        eq(documentReferences.paperId, paperId),
        isNull(documentReferences.semanticScholarId),
      ),
    );
  return {
    totalRefs: totalRow?.n ?? 0,
    totalUnenriched: unenrichedRow?.n ?? 0,
  };
}

export async function enqueueCitationEnrichmentJob(paperId: string): Promise<JobRow> {
  const { totalRefs, totalUnenriched } = await getReferenceCounts(paperId);
  const now = new Date();
  const status = totalUnenriched > 0 ? "queued" : "completed";
  const enrichedRefs = Math.max(totalRefs - totalUnenriched, 0);

  const [job] = await db
    .insert(citationEnrichmentJobs)
    .values({
      paperId,
      status,
      attempts: 0,
      nextRunAt: now,
      lockedUntil: null,
      lastError: null,
      totalRefs,
      enrichedRefs,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: citationEnrichmentJobs.paperId,
      set: {
        status,
        attempts: 0,
        nextRunAt: now,
        lockedUntil: null,
        lastError: null,
        totalRefs,
        enrichedRefs,
        updatedAt: now,
      },
    })
    .returning();

  return job;
}

export async function getCitationEnrichmentStatus(
  paperId: string,
): Promise<CitationEnrichmentStatus> {
  const [{ totalUnenriched }, rows] = await Promise.all([
    getReferenceCounts(paperId),
    db
      .select()
      .from(citationEnrichmentJobs)
      .where(eq(citationEnrichmentJobs.paperId, paperId))
      .limit(1),
  ]);
  const job = rows[0];
  if (!job) {
    return {
      status: totalUnenriched > 0 ? "idle" : "completed",
      totalUnenriched,
      nextRunAt: null,
      lastError: null,
    };
  }
  return {
    status: job.status,
    totalUnenriched,
    nextRunAt: job.nextRunAt.toISOString(),
    lastError: job.lastError,
  };
}

async function claimNextDueJob(now = new Date()): Promise<JobRow | null> {
  const candidates = await db
    .select()
    .from(citationEnrichmentJobs)
    .where(
      and(
        inArray(citationEnrichmentJobs.status, ["queued", "running"]),
        lte(citationEnrichmentJobs.nextRunAt, now),
        or(
          isNull(citationEnrichmentJobs.lockedUntil),
          lt(citationEnrichmentJobs.lockedUntil, now),
        ),
      ),
    )
    .orderBy(asc(citationEnrichmentJobs.nextRunAt), asc(citationEnrichmentJobs.updatedAt))
    .limit(1);

  const candidate = candidates[0];
  if (!candidate) return null;

  const [claimed] = await db
    .update(citationEnrichmentJobs)
    .set({
      status: "running",
      attempts: sql`${citationEnrichmentJobs.attempts} + 1`,
      lockedUntil: new Date(now.getTime() + LOCK_MS),
      updatedAt: now,
    })
    .where(
      and(
        eq(citationEnrichmentJobs.paperId, candidate.paperId),
        or(
          isNull(citationEnrichmentJobs.lockedUntil),
          lt(citationEnrichmentJobs.lockedUntil, now),
        ),
      ),
    )
    .returning();

  return claimed ?? null;
}

export async function runCitationEnrichmentBatch(now = new Date()): Promise<{
  ok: true;
  paperId: string | null;
  processed: number;
  enriched: number;
  status: "idle" | JobRow["status"];
}> {
  const job = await claimNextDueJob(now);
  if (!job) {
    return { ok: true, paperId: null, processed: 0, enriched: 0, status: "idle" };
  }

  const ownerRows = await db
    .select({ userId: papers.userId })
    .from(papers)
    .where(eq(papers.id, job.paperId))
    .limit(1);
  const owner = ownerRows[0];
  if (!owner) {
    await db.delete(citationEnrichmentJobs).where(eq(citationEnrichmentJobs.paperId, job.paperId));
    return { ok: true, paperId: job.paperId, processed: 0, enriched: 0, status: "completed" };
  }

  const refs = await db
    .select({
      id: documentReferences.id,
      title: documentReferences.title,
      doi: documentReferences.doi,
    })
    .from(documentReferences)
    .where(
      and(
        eq(documentReferences.paperId, job.paperId),
        isNull(documentReferences.semanticScholarId),
      ),
    )
    .orderBy(asc(documentReferences.markerIndex), asc(documentReferences.id))
    .limit(BATCH_SIZE);

  if (refs.length === 0) {
    await enqueueCitationEnrichmentJob(job.paperId);
    return { ok: true, paperId: job.paperId, processed: 0, enriched: 0, status: "completed" };
  }

  try {
    const enriched = await enrichReferenceBatchInDb(refs, owner.userId, {
      throwOnRateLimit: true,
    });
    const { totalRefs, totalUnenriched } = await getReferenceCounts(job.paperId);
    const done = totalUnenriched === 0;
    await db
      .update(citationEnrichmentJobs)
      .set({
        status: done ? "completed" : "queued",
        nextRunAt: done ? now : new Date(now.getTime() + 60_000),
        lockedUntil: null,
        lastError: null,
        totalRefs,
        enrichedRefs: Math.max(totalRefs - totalUnenriched, 0),
        updatedAt: now,
      })
      .where(eq(citationEnrichmentJobs.paperId, job.paperId));
    return {
      ok: true,
      paperId: job.paperId,
      processed: refs.length,
      enriched,
      status: done ? "completed" : "queued",
    };
  } catch (err) {
    const rateLimited = err instanceof SemanticScholarRateLimitError;
    const nextRunAt = new Date(
      now.getTime() + (rateLimited ? RATE_LIMIT_BACKOFF_MS : ERROR_BACKOFF_MS),
    );
    const failed = !rateLimited && job.attempts >= MAX_ATTEMPTS;
    await db
      .update(citationEnrichmentJobs)
      .set({
        status: failed ? "failed" : "queued",
        nextRunAt,
        lockedUntil: null,
        lastError: err instanceof Error ? err.message : String(err),
        updatedAt: now,
      })
      .where(eq(citationEnrichmentJobs.paperId, job.paperId));
    return {
      ok: true,
      paperId: job.paperId,
      processed: 0,
      enriched: 0,
      status: failed ? "failed" : "queued",
    };
  }
}
