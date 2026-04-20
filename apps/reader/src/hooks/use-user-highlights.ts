"use client";

import { useEffect, useState } from "react";
import type { UserHighlight } from "@/components/reader/user-highlight-layer";

interface RawHighlight {
  id: number;
  pageNumber: number;
  textContent: string;
  color: string;
  note: string | null;
  comment: string | null;
  source?: string | null;
  layerId?: string | null;
  rects: { page: number; x0: number; y0: number; x1: number; y1: number }[] | null;
  createdAt: string;
}

export type SidebarHighlight = RawHighlight;

type Result = {
  highlights: SidebarHighlight[];
  userHighlights: UserHighlight[];
  loading: boolean;
  error: string | null;
};

const VALID_COLORS: UserHighlight["color"][] = [
  "yellow",
  "green",
  "blue",
  "pink",
  "orange",
  "amber",
];

function toUserHighlight(h: RawHighlight): UserHighlight {
  const color = (VALID_COLORS as string[]).includes(h.color)
    ? (h.color as UserHighlight["color"])
    : "yellow";
  const source: UserHighlight["source"] = h.source === "ai-auto" ? "ai-auto" : "user";
  return {
    id: h.id,
    color,
    source,
    layerId: h.layerId ?? null,
    rects: h.rects,
  };
}

/**
 * Fetches the user's highlights for a document and keeps both the raw sidebar
 * shape and the `UserHighlight[]` shape expected by the PDF overlay in sync.
 * Re-fetches whenever `refreshKey` changes.
 */
export function useUserHighlights(documentId: number, refreshKey: number = 0): Result {
  const [state, setState] = useState<{
    highlights: SidebarHighlight[];
    loading: boolean;
    error: string | null;
  }>({ highlights: [], loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/documents/${documentId}/highlights`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { highlights: SidebarHighlight[] }) => {
        setState({ highlights: data.highlights ?? [], loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setState((prev) => ({ ...prev, loading: false, error: "Failed to load highlights" }));
      });
    return () => controller.abort();
  }, [documentId, refreshKey]);

  const { highlights, loading, error } = state;

  return {
    highlights,
    userHighlights: highlights.map(toUserHighlight),
    loading,
    error,
  };
}
