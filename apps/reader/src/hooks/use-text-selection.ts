"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface TextSelection {
  text: string;
  pageNumber: number;
  startOffset: number;
  endOffset: number;
  rect: { top: number; left: number; width: number; height: number };
  rects: { page: number; x0: number; y0: number; x1: number; y1: number }[];
}

export function useTextSelection() {
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const handleSelectionChange = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setSelection(null);
      return;
    }

    const text = sel.toString().trim();
    const range = sel.getRangeAt(0);
    const domRect = range.getBoundingClientRect();
    const rect = { top: domRect.top, left: domRect.left, width: domRect.width, height: domRect.height };

    // Find which PDF page this selection is on. react-pdf's internal <Page>
    // also sets data-page-number on its own div (without the natural-size
    // attrs we set on the outer wrapper), so the nearest ancestor match is
    // not enough — we must walk up to the wrapper that carries
    // data-natural-width, which is the outer PdfPage div.
    const startEl =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const pageEl =
      startEl?.closest<HTMLElement>("[data-natural-width][data-page-number]") ??
      startEl?.closest<HTMLElement>("[data-page-number]") ??
      null;
    const pageNumber = pageEl ? Number(pageEl.getAttribute("data-page-number")) : 1;

    const naturalWidth = pageEl ? Number(pageEl.getAttribute("data-natural-width")) : NaN;
    const naturalHeight = pageEl ? Number(pageEl.getAttribute("data-natural-height")) : NaN;
    let rects: TextSelection["rects"] = [];
    if (pageEl && Number.isFinite(naturalWidth) && naturalWidth > 0 && Number.isFinite(naturalHeight) && naturalHeight > 0) {
      const pageBox = pageEl.getBoundingClientRect();
      const scale = pageBox.width / naturalWidth;
      rects = Array.from(range.getClientRects()).map((r) => ({
        page: pageNumber,
        x0: (r.left - pageBox.left) / scale,
        x1: (r.right - pageBox.left) / scale,
        y0: naturalHeight - (r.bottom - pageBox.top) / scale,
        y1: naturalHeight - (r.top - pageBox.top) / scale,
      }));
    }

    setSelection({
      text,
      pageNumber,
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      rect,
      rects,
    });
  }, []);

  useEffect(() => {
    const debouncedHandler = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(handleSelectionChange, 50);
    };

    document.addEventListener("selectionchange", debouncedHandler);
    return () => {
      document.removeEventListener("selectionchange", debouncedHandler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [handleSelectionChange]);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, []);

  return { selection, clearSelection };
}
