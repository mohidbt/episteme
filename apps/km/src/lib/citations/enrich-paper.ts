// Per-reference Semantic Scholar enrichment for a single paper's
// documentReferences rows. Extracted from the /citations/enrich route so the
// extract route can fire-and-forget the same logic on first extraction.
//
// Idempotent: only enriches rows where semanticScholarId IS NULL.
// Pure per-row resolution (DOI exact → title match) — NO ordinal assumption.

import { db } from "@/lib/db";
import { documentReferences } from "@episteme/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getUserS2Key } from "@episteme/auth/byok";
import {
  enrichReferences,
  type EnrichmentResult,
} from "@/lib/citations/semantic-scholar";

export async function enrichPaperReferencesInDb(
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
        isNull(documentReferences.semanticScholarId),
      ),
    );

  const total = refs.length;
  if (total === 0) return { enriched: 0, total: 0 };

  const s2Key = await getUserS2Key(userId);
  const results = await enrichReferences(refs, { apiKey: s2Key ?? undefined });

  type Resolved = EnrichmentResult & {
    metadata: NonNullable<EnrichmentResult["metadata"]>;
  };
  const enriched = results.filter((r): r is Resolved => r.metadata !== null);

  await Promise.all(
    enriched.map(({ refId, metadata }) =>
      db
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
        })
        .where(eq(documentReferences.id, refId)),
    ),
  );

  return { enriched: enriched.length, total };
}
