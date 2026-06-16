// Client-side helper for the OpenRouter model catalog.
// Backend is a 24h-TTL DB cache (populated by the Python service); this layer
// adds a 5-minute in-memory cache so the same browser tab doesn't refetch on
// every Settings render.

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt: string; completion: string };
  supported_parameters?: string[];
  // Allow other fields without over-specifying the schema.
  [key: string]: unknown;
}

export interface ModelCatalog {
  models: OpenRouterModel[];
  fetchedAt: string;
}

const CLIENT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  data: ModelCatalog;
}

let cache: CacheEntry | null = null;
let inflight: Promise<ModelCatalog> | null = null;

export function _resetCatalogCacheForTests(): void {
  cache = null;
  inflight = null;
}

async function _doFetch(): Promise<ModelCatalog> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch("/api/openrouter/catalog", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!r.ok) {
      throw new Error(`openrouter catalog fetch failed: ${r.status}`);
    }
    const body = (await r.json()) as {
      models: OpenRouterModel[];
      fetched_at: string | null;
    };
    return {
      models: body.models ?? [],
      fetchedAt: body.fetched_at ?? "",
    };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchModelCatalog(): Promise<ModelCatalog> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.data;
  }
  if (inflight) {
    return inflight;
  }
  inflight = _doFetch()
    .then((data) => {
      cache = { data, expiresAt: Date.now() + CLIENT_TTL_MS };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
