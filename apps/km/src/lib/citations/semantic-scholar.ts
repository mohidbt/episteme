import type { Author } from "./author-utils";

export class SemanticScholarRateLimitError extends Error {
  constructor(message = "Semantic Scholar returned 429") {
    super(message);
    this.name = "SemanticScholarRateLimitError";
  }
}

const BASE_URL = "https://api.semanticscholar.org/graph/v1/paper";
const FIELDS =
  "paperId,title,authors.name,authors.authorId,year,externalIds,abstract,venue,citationCount,influentialCitationCount,openAccessPdf,isOpenAccess,tldr,citationStyles";
const RETRY_DELAY_MS = 5_000;
const RESOLVE_DELAY_MS = 500;
const BATCH_CHUNK_SIZE = 500;

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

export async function resolvePaperId(
  ref: ReferenceForEnrichment,
  opts: { apiKey?: string } = {},
): Promise<string | null> {
  const { apiKey } = opts;

  if (ref.doi?.trim()) {
    const doi = ref.doi.trim();
    // Try DOI: scheme first.
    const encoded = encodeURIComponent(`DOI:${doi}`);
    const url = `${BASE_URL}/${encoded}?fields=paperId`;
    const response = await fetchGet(url, apiKey);
    if (response) {
      const data = (await response.json()) as { paperId?: string };
      if (data.paperId) return data.paperId;
    }
    // ARXIV: fallback. S2 returns 404 on `DOI:10.48550/arXiv.X` — re-try
    // via the canonical `ARXIV:X` scheme. Matches both `10.48550/arXiv.X`
    // (canonical) and bare `arXiv:X` forms.
    const arxivMatch =
      doi.match(/^10\.48550\/arXiv\.(.+)$/i) ?? doi.match(/^arXiv:(.+)$/i);
    if (arxivMatch) {
      const arxivId = arxivMatch[1];
      const arxivEncoded = encodeURIComponent(`ARXIV:${arxivId}`);
      const arxivUrl = `${BASE_URL}/${arxivEncoded}?fields=paperId`;
      const arxivResp = await fetchGet(arxivUrl, apiKey);
      if (arxivResp) {
        const data = (await arxivResp.json()) as { paperId?: string };
        if (data.paperId) return data.paperId;
      }
    }
  }

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

export async function fetchPaperBatch(
  paperIds: string[],
  opts: { apiKey?: string } = {},
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

export async function enrichReferences(
  refs: ReferenceForEnrichment[],
  opts: { apiKey?: string } = {},
): Promise<EnrichmentResult[]> {
  const resolved: Array<{ ref: ReferenceForEnrichment; paperId: string | null }> = [];

  for (let i = 0; i < refs.length; i++) {
    const paperId = await resolvePaperId(refs[i], opts);
    resolved.push({ ref: refs[i], paperId });
    if (i < refs.length - 1) await sleep(RESOLVE_DELAY_MS);
  }

  const ids = resolved.map((r) => r.paperId).filter((x): x is string => !!x);
  const papers = await fetchPaperBatch(ids, opts);

  const paperById = new Map(papers.map((p) => [p.paperId, p]));

  return resolved.map(({ ref, paperId }) => ({
    refId: ref.id,
    metadata: paperId ? (paperById.get(paperId) ?? null) : null,
  }));
}
