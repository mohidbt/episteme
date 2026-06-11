// GSD-74 — lazy-on-view citation enrichment. Called from
// GET /api/papers/[id]/citations and POST /citations/enrich via `after()` so
// the un-enriched payload is already on the wire when this runs.
//
// GSD-90 — two-phase + global rate-limit discipline.
//
// S2 free-tier policy: 1 request/second cumulative across ALL endpoints.
// Earlier implementation issued `resolvePaperId` + `fetchPaperBatch([sid])`
// back-to-back per iteration with zero gap = burst of 2 reqs in ~50ms = 429.
//
// New flow:
//   Phase A: resolve each ref's DOI -> S2 paperId, one S2 call per iter,
//            ≥RESOLVE_DELAY_MS between calls. Stamp enriched_at for refs that
//            resolve to null so we don't reprobe.
//   Phase B: chunk resolved sids (BATCH_CHUNK_SIZE), ≥RESOLVE_DELAY_MS sleep
//            before each batch call (still 1 S2 call per chunk so 1 batch
//            request returns metadata for up to 500 refs).
//   On 429 in either phase: persist work-so-far + return partial progress.
//
// In-process mutex keyed by paperId dedups concurrent panel-opens for the same
// paper within a single process. Cross-process collisions remain but the
// persist WHERE clause filters to `enriched_at IS NULL` so wasted work is
// bounded to duplicate S2 reads (no corrupt writes).
//
// RISK (accepted): A pg advisory lock would give cross-process dedup but
// transaction-scoped locks require holding a tx open across all sleeps (bad in
// Fluid Compute pooled connections); session-scoped locks are unreliable on
// pooled connections. See plan file for follow-up: process-wide token bucket.

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentReferences } from "@episteme/db/schema";
import { getUserS2Key } from "@episteme/auth/byok";
import {
  resolvePaperId,
  fetchPaperBatch,
  SemanticScholarRateLimitError,
  type PaperMetadata,
  type ReferenceForEnrichment,
} from "@/lib/citations/semantic-scholar";

const RESOLVE_DELAY_MS = 1100;
const BATCH_CHUNK_SIZE = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// In-process dedup: if a request for the same paperId is in flight, second
// caller returns immediately with the in-flight count snapshot (0 enriched,
// total = best-effort guess via pending count). Released in finally.
const inflight = new Map<string, Promise<{ enriched: number; total: number }>>();

async function persistRefEnrichment(
  refId: number,
  metadata: PaperMetadata,
  now: Date,
): Promise<void> {
  await db
    .update(documentReferences)
    .set({
      semanticScholarId: metadata.paperId,
      title: metadata.title,
      authors: metadata.authors.length > 0 ? metadata.authors : null,
      year: metadata.year != null ? String(metadata.year) : null,
      doi: metadata.externalIds?.DOI ?? null,
      url: metadata.paperId
        ? `https://www.semanticscholar.org/paper/${metadata.paperId}`
        : null,
      abstract: metadata.abstract,
      venue: metadata.venue,
      citationCount: metadata.citationCount,
      influentialCitationCount: metadata.influentialCitationCount,
      openAccessPdfUrl: metadata.openAccessPdfUrl,
      tldrText: metadata.tldr,
      externalIds: metadata.externalIds,
      bibtex: metadata.bibtex,
      enrichedAt: now,
    })
    .where(
      and(
        eq(documentReferences.id, refId),
        isNull(documentReferences.enrichedAt),
      ),
    );
}

async function stampEnriched(refId: number, now: Date): Promise<void> {
  // Ref resolved to no S2 paper or no metadata — stamp enriched_at anyway so
  // we don't re-query S2 for a known-empty result every panel open.
  await db
    .update(documentReferences)
    .set({ enrichedAt: now })
    .where(
      and(
        eq(documentReferences.id, refId),
        isNull(documentReferences.enrichedAt),
      ),
    );
}

async function runEnrichment(
  paperId: string,
  userId: string,
): Promise<{ enriched: number; total: number }> {
  const refs = await db
    .select({
      id: documentReferences.id,
      title: documentReferences.title,
      doi: documentReferences.doi,
    })
    .from(documentReferences)
    .where(
      and(
        eq(documentReferences.paperId, paperId),
        isNull(documentReferences.enrichedAt),
        isNotNull(documentReferences.doi),
      ),
    );

  if (refs.length === 0) return { enriched: 0, total: 0 };

  const s2Key = await getUserS2Key(userId);
  const apiKey = s2Key ?? undefined;

  // Phase A: resolve loop. One S2 call per ref, ≥1100ms gap between calls.
  const resolved: Array<{ refId: number; sid: string }> = [];
  let rateLimited = false;

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i] as ReferenceForEnrichment;
    try {
      const sid = await resolvePaperId(ref, { apiKey, throwOnRateLimit: true });
      if (sid) {
        resolved.push({ refId: ref.id, sid });
      } else {
        // Resolved to null — stamp now so we don't reprobe next panel-open.
        await stampEnriched(ref.id, new Date());
      }
    } catch (err) {
      if (err instanceof SemanticScholarRateLimitError) {
        console.warn(
          "[lazy-enrich] S2 rate-limited in resolve phase for paper",
          paperId,
          "after",
          i,
          "of",
          refs.length,
        );
        rateLimited = true;
        break;
      }
      console.warn("[lazy-enrich] resolve failed for ref", ref.id, "paper", paperId, err);
      // Non-rate-limit error: leave this ref unenriched, continue with next.
    }
    if (i < refs.length - 1) await sleep(RESOLVE_DELAY_MS);
  }

  if (resolved.length === 0) {
    return { enriched: 0, total: refs.length };
  }

  // Phase B: batched fetch. Chunk resolved sids (up to 500/call).
  // Sleep before EACH chunk to respect the same 1 req/sec bucket as phase A.
  let enriched = 0;

  for (let i = 0; i < resolved.length; i += BATCH_CHUNK_SIZE) {
    const chunk = resolved.slice(i, i + BATCH_CHUNK_SIZE);
    const sids = chunk.map((c) => c.sid);

    // Always sleep before a phase-B call — phase A just made an S2 request
    // (either the final resolve or a 429 retry inside it), so we must respect
    // the cumulative bucket. Same applies between batch chunks.
    await sleep(RESOLVE_DELAY_MS);

    let metadataList: PaperMetadata[];
    try {
      metadataList = await fetchPaperBatch(sids, { apiKey, throwOnRateLimit: true });
    } catch (err) {
      if (err instanceof SemanticScholarRateLimitError) {
        console.warn(
          "[lazy-enrich] S2 rate-limited in batch phase for paper",
          paperId,
          "after",
          enriched,
          "of",
          resolved.length,
          "resolved",
        );
        return { enriched, total: refs.length };
      }
      console.warn("[lazy-enrich] batch fetch failed for paper", paperId, err);
      continue;
    }

    // Correlate metadata back to refIds. S2 batch endpoint preserves order
    // and may return null for unknown sids — we use paperId for resilience.
    const metadataBySid = new Map(metadataList.map((m) => [m.paperId, m]));

    const now = new Date();
    for (const { refId, sid } of chunk) {
      const metadata = metadataBySid.get(sid);
      if (metadata) {
        await persistRefEnrichment(refId, metadata, now);
        enriched++;
      } else {
        await stampEnriched(refId, now);
      }
    }
  }

  // If phase A was rate-limited mid-stream, we still report total=refs.length
  // so the caller knows there's more work pending; unresolved refs simply
  // remain enriched_at IS NULL and get retried on next panel-open.
  void rateLimited;

  return { enriched, total: refs.length };
}

export async function enrichRefsForPaperLazily(
  paperId: string,
  userId: string,
): Promise<{ enriched: number; total: number }> {
  const existing = inflight.get(paperId);
  if (existing) {
    // Concurrent call for same paper — return zero-work snapshot. Caller can
    // poll again; the in-flight task will eventually persist results.
    return { enriched: 0, total: 0 };
  }

  const task = runEnrichment(paperId, userId).finally(() => {
    inflight.delete(paperId);
  });
  inflight.set(paperId, task);
  return task;
}
