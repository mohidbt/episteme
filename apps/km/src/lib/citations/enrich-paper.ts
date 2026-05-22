// Per-reference Semantic Scholar enrichment for a single paper's
// documentReferences rows. Extracted from the /citations/enrich route so the
// extract route can fire-and-forget the same logic on first extraction.
//
// Idempotent: only enriches rows where semanticScholarId IS NULL.
// Pure per-row resolution (DOI exact → title match) — NO ordinal assumption.
//
// Chunked writes: persists each CHUNK_SIZE-sized batch immediately, so if the
// runtime hits its execution deadline mid-loop the already-resolved chunks
// stick. Previously a single end-of-loop Promise.all meant a timeout at ref
// N-1 dropped all N writes.

import { db } from "@/lib/db";
import { documentReferences } from "@episteme/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getUserS2Key } from "@episteme/auth/byok";
import {
  resolvePaperId,
  fetchPaperBatch,
  type PaperMetadata,
  type ReferenceForEnrichment,
} from "@/lib/citations/semantic-scholar";

const CHUNK_SIZE = 20;
// Lowered 500→100ms: S2 batch endpoint absorbs burstiness, and per-ref
// pacing at 500ms meant a 20-ref chunk spent ~10s sleeping before the batch
// fetch — frequently breaching the serverless execution deadline mid-loop.
const RESOLVE_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function persistEnrichment(
  refId: number,
  metadata: PaperMetadata,
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
    })
    .where(eq(documentReferences.id, refId));
}

async function enrichChunk(
  chunk: ReferenceForEnrichment[],
  apiKey: string | undefined,
): Promise<number> {
  const resolved: Array<{ ref: ReferenceForEnrichment; paperId: string | null }> = [];
  for (let i = 0; i < chunk.length; i++) {
    const paperId = await resolvePaperId(chunk[i], { apiKey });
    resolved.push({ ref: chunk[i], paperId });
    if (i < chunk.length - 1) await sleep(RESOLVE_DELAY_MS);
  }

  const ids = resolved.map((r) => r.paperId).filter((x): x is string => !!x);
  const papers = ids.length > 0 ? await fetchPaperBatch(ids, { apiKey }) : [];
  const byId = new Map(papers.map((p) => [p.paperId, p]));

  let enriched = 0;
  await Promise.all(
    resolved.map(async ({ ref, paperId }) => {
      if (!paperId) return;
      const metadata = byId.get(paperId);
      if (!metadata) return;
      await persistEnrichment(ref.id, metadata);
      enriched++;
    }),
  );
  return enriched;
}

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
  const apiKey = s2Key ?? undefined;

  let enrichedTotal = 0;
  for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
    const chunk = refs.slice(i, i + CHUNK_SIZE);
    enrichedTotal += await enrichChunk(chunk, apiKey);
  }

  return { enriched: enrichedTotal, total };
}
