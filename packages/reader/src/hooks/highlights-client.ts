"use client";

export type HighlightSource = "user" | "ai";

export type HighlightFetchErrorKind = "http" | "auth" | "parse" | "network" | "aborted";

export type HighlightFetchError = {
  kind: HighlightFetchErrorKind;
  status?: number;
};

type FetchSuccess<T> = {
  ok: true;
  highlights: T[];
  status: number;
};

type FetchFailure = {
  ok: false;
  error: HighlightFetchError;
};

export type FetchHighlightsResult<T> = FetchSuccess<T> | FetchFailure;

function shouldLogDebug(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

function logDebug(event: string, meta: Record<string, unknown>) {
  if (!shouldLogDebug()) return;
  // Compact structured metadata for debugging fetch lifecycle without content payloads.
  console.debug(event, meta);
}

function normalizeHighlights<T>(parsed: unknown): T[] | null {
  if (Array.isArray(parsed)) return parsed as T[];
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { highlights?: unknown }).highlights)
  ) {
    return (parsed as { highlights: T[] }).highlights;
  }
  return null;
}

export function logHighlightsErrorCleared(args: { paperId: string; source: HighlightSource }) {
  logDebug("highlights_error_cleared", {
    paperId: args.paperId,
    source: args.source,
  });
}

export async function fetchHighlights<T>(args: {
  paperId: string;
  source: HighlightSource;
  url: string;
  signal: AbortSignal;
}): Promise<FetchHighlightsResult<T>> {
  const { paperId, source, url, signal } = args;
  logDebug("highlights_fetch_start", { paperId, source });

  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err: unknown) {
    const error: HighlightFetchError =
      err instanceof Error && err.name === "AbortError"
        ? { kind: "aborted" }
        : { kind: "network" };
    logDebug("highlights_fetch_fail", { paperId, source, errorKind: error.kind });
    return { ok: false, error };
  }

  if (!res.ok) {
    const kind: HighlightFetchErrorKind = res.status === 401 || res.status === 403 ? "auth" : "http";
    logDebug("highlights_fetch_fail", {
      paperId,
      source,
      errorKind: kind,
      status: res.status,
    });
    return { ok: false, error: { kind, status: res.status } };
  }

  try {
    const raw = await res.text();
    if (!raw) {
      logDebug("highlights_fetch_success", { paperId, source, count: 0, status: res.status });
      return { ok: true, highlights: [], status: res.status };
    }
    const parsed = JSON.parse(raw) as unknown;
    const highlights = normalizeHighlights<T>(parsed);
    if (!highlights) {
      logDebug("highlights_fetch_fail", {
        paperId,
        source,
        errorKind: "parse",
        status: res.status,
      });
      return { ok: false, error: { kind: "parse", status: res.status } };
    }
    logDebug("highlights_fetch_success", {
      paperId,
      source,
      count: highlights.length,
      status: res.status,
    });
    return { ok: true, highlights, status: res.status };
  } catch {
    logDebug("highlights_fetch_fail", {
      paperId,
      source,
      errorKind: "parse",
      status: res.status,
    });
    return { ok: false, error: { kind: "parse", status: res.status } };
  }
}
