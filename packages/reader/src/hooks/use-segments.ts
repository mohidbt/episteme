"use client";

import { useEffect, useState } from "react";
import type { DocumentSegmentPayload } from "@episteme/db/schema";

export interface SegmentBase {
  id: number;
  page: number;
  kind: "section_header" | "figure" | "formula";
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface RawSegment extends SegmentBase {
  payload: DocumentSegmentPayload;
}

export interface SegmentWithPayload extends SegmentBase {
  payload: DocumentSegmentPayload;
}

type Result = {
  segments: SegmentWithPayload[];
  loading: boolean;
  error: string | null;
};

/**
 * Fetches document segments (section_header, figure, formula) for the reader.
 * Paragraph and table rows are filtered server-side.
 */
export function useSegments(paperId: string): Result {
  const [state, setState] = useState<{
    segments: SegmentWithPayload[];
    loading: boolean;
    error: string | null;
  }>({ segments: [], loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/documents/${paperId}/segments`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { segments: RawSegment[] }) => {
        setState({
          segments: data.segments ?? [],
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setState((prev) => ({ ...prev, loading: false, error: "Failed to load segments" }));
      });
    return () => controller.abort();
  }, [paperId]);

  return state;
}
