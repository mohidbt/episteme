// Source-paper references fetch via Semantic Scholar Graph API.
//
// Returns the cited-paper list (in citation order) for a given source DOI.
// Free-tier rate limit is ~1 req/sec; a module-scoped serial limiter spaces
// concurrent callers ≥1100ms apart. Never throws on transient errors — null
// on 404/429/network failure; [] on a successful response with no refs.

// Server-side only. Not marked with `server-only` to keep vitest compatibility
// with the rest of `src/lib/*`; only the route handler imports this module.

const FIELDS =
  "title,authors,year,externalIds,abstract,venue,citationCount,influentialCitationCount,openAccessPdf,tldr,paperId";
const LIMIT = 1000;
const SPACING_MS = 1100;

export interface S2Reference {
  paperId: string | null;
  title: string | null;
  authors: { name: string }[];
  year: number | null;
  doi: string | null;
  externalIds: Record<string, string> | null;
  abstract: string | null;
  venue: string | null;
  citationCount: number | null;
  influentialCitationCount: number | null;
  openAccessPdfUrl: string | null;
  tldrText: string | null;
}

interface RawCitedPaper {
  paperId?: string | null;
  title?: string | null;
  authors?: { name: string }[] | null;
  year?: number | null;
  externalIds?: Record<string, string> | null;
  abstract?: string | null;
  venue?: string | null;
  citationCount?: number | null;
  influentialCitationCount?: number | null;
  openAccessPdf?: { url?: string | null } | null;
  tldr?: { text?: string | null } | null;
}

// Module-scoped serial chain: each call awaits the previous, and ensures at
// least SPACING_MS between successive fetch starts.
let s2Chain: Promise<void> = Promise.resolve();
let s2LastStart = 0;

function s2Schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = s2Chain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, s2LastStart + SPACING_MS - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    s2LastStart = Date.now();
  });
  // Keep the chain alive even if `fn` throws so later callers still get spaced.
  s2Chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run.then(() => fn());
}

/** Test-only: reset the limiter state between test cases. */
export function __resetS2LimiterForTests(): void {
  s2Chain = Promise.resolve();
  s2LastStart = 0;
}

function mapCitedPaper(raw: RawCitedPaper): S2Reference {
  return {
    paperId: raw.paperId ?? null,
    title: raw.title ?? null,
    authors: (raw.authors ?? []).map((a) => ({ name: a.name })),
    year: raw.year ?? null,
    doi: raw.externalIds?.DOI ?? null,
    externalIds: raw.externalIds ?? null,
    abstract: raw.abstract ?? null,
    venue: raw.venue ?? null,
    citationCount: raw.citationCount ?? null,
    influentialCitationCount: raw.influentialCitationCount ?? null,
    openAccessPdfUrl: raw.openAccessPdf?.url ?? null,
    tldrText: raw.tldr?.text ?? null,
  };
}

export async function fetchPaperReferences(
  doi: string,
): Promise<S2Reference[] | null> {
  const encoded = encodeURIComponent(`DOI:${doi.trim()}`);
  const url = `https://api.semanticscholar.org/graph/v1/paper/${encoded}/references?fields=${FIELDS}&limit=${LIMIT}`;

  return s2Schedule(async () => {
    let resp: Response;
    try {
      resp = await fetch(url);
    } catch (err) {
      console.warn("[s2:fetchPaperReferences] fetch failed", err);
      return null;
    }
    if (resp.status === 404 || resp.status === 429) return null;
    if (!resp.ok) {
      console.warn("[s2:fetchPaperReferences] non-OK", resp.status);
      return null;
    }
    let body: { data?: { citedPaper?: RawCitedPaper | null }[] };
    try {
      body = (await resp.json()) as typeof body;
    } catch (err) {
      console.warn("[s2:fetchPaperReferences] json parse failed", err);
      return null;
    }
    const data = body.data ?? [];
    return data
      .map((d) => (d?.citedPaper ? mapCitedPaper(d.citedPaper) : null))
      .filter((r): r is S2Reference => r !== null);
  });
}
