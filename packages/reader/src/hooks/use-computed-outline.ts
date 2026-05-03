"use client";

import { useEffect, useState } from "react";
import type { PdfOutlineItem } from "@/components/reader/outline-sidebar";

interface PdfDocLike {
  numPages: number;
  getPage: (n: number) => Promise<PdfPageLike>;
}

interface PdfPageLike {
  getTextContent: (params?: {
    includeMarkedContent?: boolean;
  }) => Promise<{ items: TextItemLike[] }>;
}

interface TextItemLike {
  str?: string;
  height?: number;
  transform?: number[];
  hasEOL?: boolean;
}

interface Span {
  text: string;
  size: number;
  page: number;
}

/**
 * Heuristic, client-side outline extractor for PDFs that lack embedded
 * bookmarks. Examines text font sizes per page and treats the top 1–2
 * size tiers (above the body text median) as H1/H2 sections.
 *
 * Designed to be cheap and best-effort — never throws, returns [] on failure.
 * Caps work to avoid stalling on very large PDFs.
 */
export function useComputedOutline(
  pdfDoc: unknown,
  enabled: boolean
): { outline: PdfOutlineItem[]; loading: boolean } {
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !pdfDoc) {
      setOutline([]);
      return;
    }
    const doc = pdfDoc as PdfDocLike;
    if (typeof doc.getPage !== "function" || !doc.numPages) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        // Cap pages to keep this snappy on huge docs.
        const maxPages = Math.min(doc.numPages, 80);
        const allSpans: Span[] = [];

        for (let p = 1; p <= maxPages; p++) {
          if (cancelled) return;
          let textContent: { items: TextItemLike[] };
          try {
            const page = await doc.getPage(p);
            textContent = await page.getTextContent({ includeMarkedContent: false });
          } catch {
            continue;
          }
          // Group consecutive items with the same size into a single line/span.
          let buf: { text: string; size: number } | null = null;
          for (const it of textContent.items) {
            const raw = (it.str ?? "").trim();
            if (!raw) {
              if (buf && buf.text) {
                allSpans.push({ text: buf.text.trim(), size: buf.size, page: p });
              }
              buf = null;
              continue;
            }
            const size = Math.round(
              (it.transform && typeof it.transform[0] === "number"
                ? Math.abs(it.transform[0])
                : it.height ?? 0) * 10
            ) / 10;
            if (size <= 0) continue;
            if (!buf || Math.abs(buf.size - size) > 0.1) {
              if (buf && buf.text) {
                allSpans.push({ text: buf.text.trim(), size: buf.size, page: p });
              }
              buf = { text: raw, size };
            } else {
              buf.text += " " + raw;
            }
            if (it.hasEOL && buf.text) {
              allSpans.push({ text: buf.text.trim(), size: buf.size, page: p });
              buf = null;
            }
          }
          if (buf && buf.text) {
            allSpans.push({ text: buf.text.trim(), size: buf.size, page: p });
          }
        }

        if (cancelled) return;
        if (allSpans.length === 0) {
          setOutline([]);
          return;
        }

        // Compute body-text size as the most common size, then take the
        // top 1–2 distinct sizes above it as section heading tiers.
        const sizeCounts = new Map<number, number>();
        for (const s of allSpans) {
          sizeCounts.set(s.size, (sizeCounts.get(s.size) ?? 0) + 1);
        }
        const sortedByCount = [...sizeCounts.entries()].sort((a, b) => b[1] - a[1]);
        const bodySize = sortedByCount[0]?.[0] ?? 0;
        const distinctSizesDesc = [...sizeCounts.keys()]
          .filter((s) => s > bodySize + 0.5)
          .sort((a, b) => b - a);
        const headingSizes = distinctSizesDesc.slice(0, 2);
        if (headingSizes.length === 0) {
          setOutline([]);
          return;
        }
        const h1Size = headingSizes[0];
        const h2Size = headingSizes[1] ?? null;

        // Walk spans in document order, build a 2-level tree.
        const tree: PdfOutlineItem[] = [];
        let currentH1: PdfOutlineItem | null = null;
        const seen = new Set<string>();

        for (const span of allSpans) {
          // Skip noise: very short tokens, page numbers, things that look
          // like running headers/footers.
          if (span.text.length < 3 || span.text.length > 200) continue;
          if (/^\d+$/.test(span.text)) continue;
          const isH1 = span.size === h1Size;
          const isH2 = h2Size !== null && span.size === h2Size;
          if (!isH1 && !isH2) continue;
          const key = `${span.text.toLowerCase()}|${isH1 ? 1 : 2}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const node: PdfOutlineItem = {
            title: span.text,
            pageIndex: span.page - 1,
            items: [],
          };
          if (isH1) {
            tree.push(node);
            currentH1 = node;
          } else if (currentH1) {
            currentH1.items.push(node);
          } else {
            // Orphan H2 (no preceding H1) — promote to top level.
            tree.push(node);
          }
        }

        // Cap tree size to avoid an unwieldy panel.
        const capped = tree.slice(0, 50);
        if (!cancelled) setOutline(capped);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, enabled]);

  return { outline, loading };
}
