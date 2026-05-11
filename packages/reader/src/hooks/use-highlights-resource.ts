"use client";

import { useEffect, useRef, useState } from "react";
import {
  fetchHighlights,
  logHighlightsErrorCleared,
  type HighlightSource,
} from "./highlights-client";
import { subscribeHighlightsChange } from "../lib/highlights-channel";

const BACKSTOP_INTERVAL_MS = 300_000;

type ResourceState<T> = {
  data: T[];
  loading: boolean;
  error: string | null;
};

type UseHighlightsResourceArgs<T> = {
  paperId: string;
  refreshKey: number;
  source: HighlightSource;
  errorMessage: string;
  mapRow: (row: T) => T;
  url: string;
};

export function useHighlightsResource<T>({
  paperId,
  refreshKey,
  source,
  errorMessage,
  mapRow,
  url,
}: UseHighlightsResourceArgs<T>): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({
    data: [],
    loading: true,
    error: null,
  });

  const mapRowRef = useRef(mapRow);
  const errorMessageRef = useRef(errorMessage);
  useEffect(() => {
    mapRowRef.current = mapRow;
    errorMessageRef.current = errorMessage;
  });

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();

    const load = async (initial: boolean) => {
      if (inFlight) return;
      inFlight = true;
      try {
        await loadInner(initial);
      } finally {
        inFlight = false;
      }
    };

    const loadInner = async (initial: boolean) => {
      const result = await fetchHighlights<T>({
        paperId,
        source,
        url,
        signal: controller.signal,
      });

      if (cancelled) return;
      if (!result.ok) {
        if (result.error.kind === "aborted") return;
        if (result.error.kind === "parse") {
          setState((prev) => ({ ...prev, loading: false }));
          return;
        }
        if (initial) {
          setState((prev) => {
            if (prev.data.length > 0) return { ...prev, loading: false };
            return { ...prev, loading: false, error: errorMessageRef.current };
          });
        }
        return;
      }

      setState((prev) => {
        if (prev.error) {
          logHighlightsErrorCleared({ paperId, source });
        }
        return {
          data: result.highlights.map(mapRowRef.current),
          loading: false,
          error: null,
        };
      });
    };

    void load(true);
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void load(false);
    }, BACKSTOP_INTERVAL_MS);
    const onFocus = () => void load(false);
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }

    const unsubscribe = subscribeHighlightsChange((evt) => {
      if (evt.paperId !== paperId) return;
      if (evt.source !== source) return;
      void load(false);
    });

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
      unsubscribe();
    };
  }, [paperId, refreshKey, source, url]);

  return state;
}
