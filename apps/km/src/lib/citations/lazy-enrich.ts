// GSD-74 — lazy-on-view citation enrichment. Called from
// GET /api/papers/[id]/citations and POST /citations/enrich via `after()` so
// the un-enriched payload is already on the wire when this runs.
//
// Behavior:
//   - Only touches refs with `enriched_at IS NULL AND doi IS NOT NULL`.
//   - Per-ref incremental persistence: each successful resolve+fetch stamps
//     `enriched_at` immediately, before moving to the next ref.
//   - On `SemanticScholarRateLimitError`: returns partial progress; refs
//     already persisted stay persisted, the rest are left for next panel-open.
//   - On any other per-ref error: log + continue to next ref.
//
// No queue, no cron, no lock — concurrent calls may double-fire S2 work, but
// the persist WHERE clause filters to `enriched_at IS NULL` so a winner takes
// the row.

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

// GSD-74 round 3: per-ref incremental persistence (no chunked Promise.all).
// Earlier design batched persistence at chunk-end via Promise.all, but on
// free-tier S2 a mid-chunk 429 lost all in-flight work — the entire batch was
// abandoned without any DB write. Now each successful resolve+fetch persists
// immediately so a 429 only loses the in-flight ref, not the whole batch.
const RESOLVE_DELAY_MS = 1100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export async function enrichRefsForPaperLazily(
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
  let enriched = 0;

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i] as ReferenceForEnrichment;
    try {
      const sid = await resolvePaperId(ref, { apiKey, throwOnRateLimit: true });
      const now = new Date();
      if (sid) {
        const [metadata] = await fetchPaperBatch([sid], { apiKey, throwOnRateLimit: true });
        if (metadata) {
          await persistRefEnrichment(ref.id, metadata, now);
          enriched++;
        } else {
          await stampEnriched(ref.id, now);
        }
      } else {
        await stampEnriched(ref.id, now);
      }
    } catch (err) {
      if (err instanceof SemanticScholarRateLimitError) {
        console.warn("[lazy-enrich] S2 rate-limited mid-batch for paper", paperId, "after", enriched, "of", refs.length);
        return { enriched, total: refs.length };
      }
      console.warn("[lazy-enrich] failed for ref", ref.id, "paper", paperId, err);
      // Non-rate-limit error: leave this ref unenriched, continue with next.
    }
    if (i < refs.length - 1) await sleep(RESOLVE_DELAY_MS);
  }

  return { enriched, total: refs.length };
}
