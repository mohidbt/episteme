"use client";

import { useEffect, useState } from "react";
import type { UserHighlight } from "../components/UserHighlightLayer";

export interface PaperHighlightRow {
  id: string;
  page: number;
  bbox: unknown;
  color: string | null;
  noteMd: string | null;
  runId?: string | null;
  toolCallId?: string | null;
  createdAt: string;
}

type Result = {
  highlights: PaperHighlightRow[];
  userHighlights: UserHighlight[];
  loading: boolean;
  error: string | null;
};

function toRects(page: number, bbox: unknown): UserHighlight["rects"] {
  const one = (v: unknown): { page: number; x0: number; y0: number; x1: number; y1: number } | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const x0 = Number(o.x0);
    const y0 = Number(o.y0);
    const x1 = Number(o.x1);
    const y1 = Number(o.y1);
    const p = Number(o.page ?? page);
    if (![x0, y0, x1, y1, p].every(Number.isFinite)) return null;
    return { page: p, x0, y0, x1, y1 };
  };
  if (Array.isArray(bbox)) return bbox.map(one).filter((r): r is NonNullable<typeof r> => r !== null);
  const rect = one(bbox);
  return rect ? [rect] : null;
}

function toUserHighlight(row: PaperHighlightRow): UserHighlight {
  return {
    id: row.id,
    color: "amber",
    source: "ai-auto",
    layerId: row.runId ?? row.toolCallId ?? null,
    rects: toRects(row.page, row.bbox),
  };
}

export function usePaperHighlights(paperId: string, refreshKey: number = 0): Result {
  const [state, setState] = useState<{
    highlights: PaperHighlightRow[];
    loading: boolean;
    error: string | null;
  }>({ highlights: [], loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/paper-highlights?paperId=${paperId}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((rows: PaperHighlightRow[]) => {
        setState({ highlights: rows ?? [], loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setState((prev) => ({ ...prev, loading: false, error: "Failed to load AI highlights" }));
      });
    return () => controller.abort();
  }, [paperId, refreshKey]);

  return {
    highlights: state.highlights,
    userHighlights: state.highlights.map(toUserHighlight),
    loading: state.loading,
    error: state.error,
  };
}
