"use client";

import { useEffect, useState } from "react";
import type { ExplainSegment } from "@/components/reader/explain-marker-layer";
import type { DocumentSegmentPayload } from "@episteme/db/schema/document-segments";

interface RawSegment {
  id: number;
  page: number;
  kind: ExplainSegment["kind"];
  bbox: ExplainSegment["bbox"];
  payload: DocumentSegmentPayload;
}

export interface SegmentWithPayload extends ExplainSegment {
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
export function useSegments(documentId: number): Result {
  const [state, setState] = useState<{
    segments: SegmentWithPayload[];
    loading: boolean;
    error: string | null;
  }>({ segments: [], loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/documents/${documentId}/segments`, { signal: controller.signal })
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
  }, [documentId]);

  return state;
}
