"use client";

import { useState, useEffect, useCallback, type RefObject } from "react";
import { findCitationMarkerAtOffset } from "@/lib/citations/click-detection";
import { findCitationFromAnchor } from "@/lib/citations/find-citation-from-anchor";
import type { CitationWithStatus } from "@/components/reader/citation-card";

interface CitationClickResult {
  activeCitation: CitationWithStatus | null;
  clickPosition: { top: number; left: number } | null;
  dismiss: () => void;
}

export function useCitationClick(
  containerRef: RefObject<HTMLElement | null>,
  citations: CitationWithStatus[]
): CitationClickResult {
  const [activeCitation, setActiveCitation] = useState<CitationWithStatus | null>(null);
  const [clickPosition, setClickPosition] = useState<{ top: number; left: number } | null>(null);

  const dismiss = useCallback(() => {
    setActiveCitation(null);
    setClickPosition(null);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleClick(e: MouseEvent) {
      // Primary: our own overlay div with data-marker-index
      const markerEl = (e.target as Element).closest("[data-marker-index]");
      if (markerEl) {
        const idx = parseInt(markerEl.getAttribute("data-marker-index")!, 10);
        const citation = citations.find((c) => c.markerIndex === idx);
        if (citation) {
          const domRect = markerEl.getBoundingClientRect();
          const CARD_HEIGHT_ESTIMATE = 260;
          const top =
            domRect.bottom + 8 + CARD_HEIGHT_ESTIMATE > window.innerHeight
              ? domRect.top - CARD_HEIGHT_ESTIMATE
              : domRect.bottom + 8;
          setActiveCitation(citation);
          setClickPosition({ top, left: domRect.left });
          return;
        }
      }

      // Fallback: caretRangeFromPoint (WebKit/Blink) or caretPositionFromPoint (Firefox)
      type CaretPositionFromPoint = (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      const docWithCaret = document as Document & { caretPositionFromPoint?: CaretPositionFromPoint };

      let node: Node | null = null;
      let offset = 0;

      if (typeof document.caretRangeFromPoint === "function") {
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range) {
          node = range.startContainer;
          offset = range.startOffset;
        }
      } else if (typeof docWithCaret.caretPositionFromPoint === "function") {
        const pos = docWithCaret.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos) {
          node = pos.offsetNode;
          offset = pos.offset;
        }
      }

      let markerIndex: number | null = null;

      if (node && node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        markerIndex = findCitationMarkerAtOffset(text, offset);
      }

      // Fallback: check the target element's text content for a lone [n] marker
      if (markerIndex === null) {
        const target = e.target as HTMLElement;
        const text = target.textContent ?? "";
        if (text.trim().match(/^\[\d{1,3}\]$/)) {
          markerIndex = findCitationMarkerAtOffset(text, text.indexOf("["));
        }
      }

      // Fallback 2: pdfjs may render an internal link annotation over [n].
      // Walk up to the enclosing <a> and match its bare digit text.
      let citation = citations.find((c) => c.markerIndex === markerIndex);
      if (!citation) {
        const fromAnchor = findCitationFromAnchor(e.target as Element, citations);
        if (fromAnchor) {
          e.preventDefault();
          citation = fromAnchor;
        }
      }

      if (!citation) return;

      // Position the card just below + slightly right of the click, avoiding bottom clipping.
      // CARD_HEIGHT_ESTIMATE approximates the rendered card height (title + meta + abstract + buttons).
      const CARD_HEIGHT_ESTIMATE = 260;
      const top =
        e.clientY + CARD_HEIGHT_ESTIMATE > window.innerHeight
          ? e.clientY - CARD_HEIGHT_ESTIMATE
          : e.clientY + 12;

      setActiveCitation(citation);
      setClickPosition({ top, left: e.clientX });
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [containerRef, citations]);

  return { activeCitation, clickPosition, dismiss };
}
