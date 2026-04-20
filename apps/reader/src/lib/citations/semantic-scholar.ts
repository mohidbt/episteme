import type { Author } from "./author-utils";

const BASE_URL = "https://api.semanticscholar.org/graph/v1/paper";
const FIELDS =
  "paperId,title,authors.name,authors.authorId,year,externalIds,abstract,venue,citationCount,influentialCitationCount,openAccessPdf,isOpenAccess,tldr,citationStyles";
const RETRY_DELAY_MS = 5_000;
const RESOLVE_DELAY_MS = 500;
const BATCH_CHUNK_SIZE = 500;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PaperMetadata {
  paperId: string;
  title: string | null;
  authors: Author[];
  year: number | null;
  externalIds: Record<string, string> | null;
  abstract: string | null;
  venue: string | null;
  citationCount: number | null;
  influentialCitationCount: number | null;
  openAccessPdfUrl: string | null;
  isOpenAccess: boolean | null;
  tldr: string | null;
  bibtex: string | null;
}

export interface ReferenceForEnrichment {
  id: number;
  title?: string | null;
  doi?: string | null;
}

export interface EnrichmentResult {
  refId: number;
  metadata: PaperMetadata | null;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RawPaper {
  paperId: string;
  title?: string | null;
  authors?: { name: string; authorId?: string }[];
  year?: number | null;
  externalIds?: Record<string, string> | null;
  abstract?: string | null;
  venue?: string | null;
  citationCount?: number | null;
  influentialCitationCount?: number | null;
  openAccessPdf?: { url: string } | null;
  isOpenAccess?: boolean | null;
  tldr?: { text: string } | null;
  citationStyles?: { bibtex?: string } | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mapPaper(raw: RawPaper): PaperMetadata {
  return {
    paperId: raw.paperId,
    title: raw.title ?? null,
    authors: (raw.authors ?? []).map((a) => ({
      name: a.name,
      ...(a.authorId ? { authorId: a.authorId } : {}),
    })),
    year: raw.year ?? null,
    externalIds: raw.externalIds ?? null,
    abstract: raw.abstract ?? null,
    venue: raw.venue ?? null,
    citationCount: raw.citationCount ?? null,
    influentialCitationCount: raw.influentialCitationCount ?? null,
    openAccessPdfUrl: raw.openAccessPdf?.url ?? null,
    isOpenAccess: raw.isOpenAccess ?? null,
    tldr: raw.tldr?.text ?? null,
    bibtex: raw.citationStyles?.bibtex ?? null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders(apiKey?: string): Record<string, string> {
  if (apiKey) return { "x-api-key": apiKey };
  return {};
}

/** Fetch with one-shot 429 retry. Returns null on 404 or persistent failure. */
async function fetchGet(url: string, apiKey?: string): Promise<Response | null> {
  const headers = buildHeaders(apiKey);
  const fetchInit = Object.keys(headers).length ? { headers } : undefined;
  let response = await fetch(url, fetchInit);

  if (response.status === 429) {
    await sleep(RETRY_DELAY_MS);
    response = await fetch(url, fetchInit);
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    console.warn(`[fetchGet] non-OK response: ${response.status} for ${url}`);
    return null;
  }
  return response;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a paperId for a reference. Tries DOI lookup first, then /search/match by title.
 * Returns null if neither resolves.
 */
export async function resolvePaperId(
  ref: ReferenceForEnrichment,
  opts: { apiKey?: string } = {}
): Promise<string | null> {
  const { apiKey } = opts;

  // Pass 1a: DOI lookup
  if (ref.doi?.trim()) {
    const encoded = encodeURIComponent(`DOI:${ref.doi.trim()}`);
    const url = `${BASE_URL}/${encoded}?fields=paperId`;
    const response = await fetchGet(url, apiKey);
    if (response) {
      const data = (await response.json()) as { paperId?: string };
      if (data.paperId) return data.paperId;
    }
  }

  // Pass 1b: title search fallback
  if (ref.title?.trim()) {
    const encoded = encodeURIComponent(ref.title.trim());
    const url = `${BASE_URL}/search/match?query=${encoded}&fields=paperId`;
    const response = await fetchGet(url, apiKey);
    if (response) {
      const data = (await response.json()) as { data?: { paperId?: string }[] };
      const first = data.data?.[0];
      if (first?.paperId) return first.paperId;
    }
  }

  return null;
}

/**
 * Batch fetch papers by paperIds. Chunks at 500 ids per call.
 * Returns PaperMetadata[] (nulls from S2 are filtered out).
 */
export async function fetchPaperBatch(
  paperIds: string[],
  opts: { apiKey?: string } = {}
): Promise<PaperMetadata[]> {
  if (paperIds.length === 0) return [];

  const { apiKey } = opts;
  const url = `${BASE_URL}/batch?fields=${FIELDS}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildHeaders(apiKey),
  };

  const results: PaperMetadata[] = [];

  for (let i = 0; i < paperIds.length; i += BATCH_CHUNK_SIZE) {
    const chunk = paperIds.slice(i, i + BATCH_CHUNK_SIZE);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ids: chunk }),
    });

    if (response.status === 429) {
      await sleep(RETRY_DELAY_MS);
      const retry = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ids: chunk }),
      });
      if (!retry.ok) {
        console.warn(`[fetchPaperBatch] non-OK response after retry: ${retry.status} (chunk size: ${chunk.length})`);
        continue;
      }
      const retryData = (await retry.json()) as (RawPaper | null)[];
      for (const item of retryData) {
        if (item) results.push(mapPaper(item));
      }
      continue;
    }

    if (!response.ok) {
      console.warn(`[fetchPaperBatch] non-OK response: ${response.status} (chunk size: ${chunk.length})`);
      continue;
    }

    const data = (await response.json()) as (RawPaper | null)[];
    for (const item of data) {
      if (item) results.push(mapPaper(item));
    }
  }

  return results;
}

/**
 * Two-pass enrichment pipeline.
 * Pass 1: resolve paperIds serially with 500ms pacing.
 * Pass 2: single batch POST for all resolved ids.
 * Returns EnrichmentResult[] — metadata is null for unresolvable refs.
 */
export async function enrichReferences(
  refs: ReferenceForEnrichment[],
  opts: { apiKey?: string } = {}
): Promise<EnrichmentResult[]> {
  // Pass 1: resolve paperId for each ref
  const resolved: Array<{ ref: ReferenceForEnrichment; paperId: string | null }> = [];

  for (let i = 0; i < refs.length; i++) {
    const paperId = await resolvePaperId(refs[i], opts);
    resolved.push({ ref: refs[i], paperId });
    if (i < refs.length - 1) await sleep(RESOLVE_DELAY_MS);
  }

  // Pass 2: batch fetch all resolved ids
  const ids = resolved.map((r) => r.paperId).filter((x): x is string => !!x);
  const papers = await fetchPaperBatch(ids, opts);

  // Index by paperId for O(1) lookup
  const paperById = new Map(papers.map((p) => [p.paperId, p]));

  // Stitch results
  return resolved.map(({ ref, paperId }) => ({
    refId: ref.id,
    metadata: paperId ? (paperById.get(paperId) ?? null) : null,
  }));
}
