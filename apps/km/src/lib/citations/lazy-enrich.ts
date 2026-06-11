// GSD-74 — lazy-on-view citation enrichment. Called from
// GET /api/papers/[id]/citations via `after()` after the un-enriched
// payload is already on the wire.
//
// Behavior:
//   - Only touches refs with `enriched_at IS NULL AND doi IS NOT NULL`.
//   - Runs the same per-row S2 resolve+batch fetch as enrich-paper.ts.
//   - Persists S2 fields AND stamps `enriched_at = now()`.
//   - On `SemanticScholarRateLimitError` (or any error): swallow + log;
//     `enriched_at` stays NULL so the next panel-open retries.
//
// No queue, no cron, no lock — concurrent GETs may double-fire S2 work,
// but persistEnrichment's WHERE clause filters to `enriched_at IS NULL`
// and the chunked-write design keeps partial progress durable.

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

const CHUNK_SIZE = 20;
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

  try {
    for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
      const chunk = refs.slice(i, i + CHUNK_SIZE) as ReferenceForEnrichment[];
      const resolved: Array<{ ref: ReferenceForEnrichment; paperId: string | null }> = [];
      for (let j = 0; j < chunk.length; j++) {
        const sid = await resolvePaperId(chunk[j], { apiKey, throwOnRateLimit: true });
        resolved.push({ ref: chunk[j], paperId: sid });
        if (j < chunk.length - 1) await sleep(RESOLVE_DELAY_MS);
      }
      const ids = resolved.map((r) => r.paperId).filter((x): x is string => !!x);
      const papers = ids.length > 0
        ? await fetchPaperBatch(ids, { apiKey, throwOnRateLimit: true })
        : [];
      const byId = new Map(papers.map((p) => [p.paperId, p]));
      const now = new Date();
      await Promise.all(
        resolved.map(async ({ ref, paperId: sid }) => {
          const metadata = sid ? byId.get(sid) : undefined;
          if (metadata) {
            await persistRefEnrichment(ref.id, metadata, now);
            enriched++;
          } else {
            await stampEnriched(ref.id, now);
          }
        }),
      );
    }
  } catch (err) {
    if (err instanceof SemanticScholarRateLimitError) {
      console.warn("[lazy-enrich] S2 rate-limited for paper", paperId);
      return { enriched, total: refs.length };
    }
    console.warn("[lazy-enrich] failed for paper", paperId, err);
  }

  return { enriched, total: refs.length };
}
