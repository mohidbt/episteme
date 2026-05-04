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

function normalizePageIndex(row: PaperHighlightRow): PaperHighlightRow {
  const isZeroBased =
    row.page === 0 ||
    (Array.isArray(row.bbox) &&
      row.bbox.some((v) => {
        if (!v || typeof v !== "object") return false;
        const p = Number((v as Record<string, unknown>).page);
        return Number.isFinite(p) && p === 0;
      }));
  if (!isZeroBased) return row;
  const bump = (v: unknown): unknown => {
    if (!v || typeof v !== "object") return v;
    const o = v as Record<string, unknown>;
    const p = Number(o.page);
    if (!Number.isFinite(p)) return v;
    return { ...o, page: p + 1 };
  };
  return {
    ...row,
    page: row.page + 1,
    bbox: Array.isArray(row.bbox) ? row.bbox.map(bump) : bump(row.bbox),
  };
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
    let cancelled = false;
    const controller = new AbortController();

    const load = async (initial: boolean) => {
      try {
        const res = await fetch(`/api/paper-highlights?paperId=${paperId}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = (await res.json()) as PaperHighlightRow[];
        if (cancelled) return;
        setState({
          highlights: (rows ?? []).map(normalizePageIndex),
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === "AbortError") return;
        // Only flag an error on the first load; later poll failures are silent
        // so a transient network blip doesn't blank out existing rows.
        if (initial) {
          setState((prev) => ({ ...prev, loading: false, error: "Failed to load AI highlights" }));
        }
      }
    };

    void load(true);
    // Live-refresh: agent-created highlights need to appear without a manual
    // page reload. Poll every 4s while the tab is visible.
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void load(false);
    }, 4000);
    const onFocus = () => void load(false);
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [paperId, refreshKey]);

  return {
    highlights: state.highlights,
    userHighlights: state.highlights.map(toUserHighlight),
    loading: state.loading,
    error: state.error,
  };
}
