"use client";

import type { UserHighlight } from "../components/UserHighlightLayer";
import { useHighlightsResource } from "./use-highlights-resource";

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
export function useUserHighlights(paperId: string, refreshKey: number = 0): Result {
  const { data: highlights, loading, error } = useHighlightsResource<SidebarHighlight>({
    paperId,
    refreshKey,
    source: "user",
    errorMessage: "Failed to load highlights",
    mapRow: (row) => row,
    url: `/api/user-highlights?paperId=${paperId}`,
  });

  return {
    highlights,
    userHighlights: highlights.map(toUserHighlight),
    loading,
    error,
  };
}
