"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { PdfPage } from "./pdf-page";
import type { UserHighlight } from "./user-highlight-layer";
import type { ExplainSegment } from "./explain-marker-layer";
import { useReaderState } from "@/hooks/use-reader-state";
import { usePdfTextSelection } from "@/hooks/use-pdf-text-selection";

// Worker must be set in the same module as Document/Page usage (react-pdf requirement)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

/** Number of pages to render above and below the visible range */
const BUFFER_PAGES = 2;
/** A4 aspect ratio (height / width) */
const A4_RATIO = 1.414;
/** Bottom margin per page in px (matches mb-4 = 16px) */
const PAGE_MARGIN = 16;

export interface MarkerRect {
  id: number;
  referenceId: number;
  markerIndex: number;
  pageNumber: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface PdfViewerProps {
  url: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  markers?: MarkerRect[];
  userHighlights?: UserHighlight[];
  hiddenLayerIds?: Set<string>;
  segments?: ExplainSegment[];
  onExplainClick?: (segmentId: number) => void;
  onPdfLoad?: (pdf: unknown) => void;
}

export function PdfViewer({ url, containerRef: externalRef, markers = [], userHighlights = [], hiddenLayerIds, segments, onExplainClick, onPdfLoad }: PdfViewerProps) {
  usePdfTextSelection();
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const setTotalPages = useReaderState((s) => s.setTotalPages);
  const totalPages = useReaderState((s) => s.totalPages);
  const scrollTargetPage = useReaderState((s) => s.scrollTargetPage);
  const setScrollTargetPage = useReaderState((s) => s.setScrollTargetPage);
  const setCurrentPage = useReaderState((s) => s.setCurrentPage);
  const zoom = useReaderState((s) => s.zoom);
  const internalRef = useRef<HTMLDivElement>(null);
  const containerRef = externalRef ?? internalRef;
  const isAnimatingRef = useRef(false);
  const [scrollTop, setScrollTop] = useState(0);

  const onDocumentLoadSuccess = useCallback(
    (pdf: { numPages: number }) => {
      setLoading(false);
      setTotalPages(pdf.numPages);
      onPdfLoad?.(pdf);
    },
    [setTotalPages, onPdfLoad]
  );

  // Measure container width and height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width - 48);
      setContainerHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  // Trackpad pinch / ctrl+wheel zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const { setZoom, zoom: cur } = useReaderState.getState();
      const factor = Math.exp(-e.deltaY * 0.005);
      setZoom(cur * factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [containerRef]);

  // Track scroll position for virtualization
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    const handler = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        setScrollTop(el.scrollTop);
        raf = 0;
      });
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => {
      el.removeEventListener("scroll", handler);
      cancelAnimationFrame(raf);
    };
  }, [containerRef]);

  // Scroll to an explicitly requested page (Prev/Next buttons, outline clicks, etc.)
  useEffect(() => {
    if (scrollTargetPage === null) return;
    const el = containerRef.current;
    if (!el) {
      setScrollTargetPage(null);
      return;
    }
    const pageEl = el.querySelector(`[data-page-number="${scrollTargetPage}"]`);
    if (pageEl) {
      isAnimatingRef.current = true;
      (pageEl as HTMLElement).scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      el.addEventListener("scrollend", () => { isAnimatingRef.current = false; }, { once: true });
    }
    setScrollTargetPage(null);
  }, [scrollTargetPage, containerRef, setScrollTargetPage]);

  // Track current page via IntersectionObserver (for toolbar display only)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || totalPages <= 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        // Suppress IO updates during programmatic smooth scroll
        if (isAnimatingRef.current) return;
        let bestRatio = 0;
        let bestPage = 0;
        for (const entry of entries) {
          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            const n = Number(
              (entry.target as HTMLElement).dataset.pageNumber
            );
            if (Number.isFinite(n)) bestPage = n;
          }
        }
        if (bestPage > 0) setCurrentPage(bestPage);
      },
      { root: el, threshold: [0.25, 0.5, 0.75] }
    );

    // Observe all elements with data-page-number anywhere within the container
    const observe = () => {
      io.disconnect();
      const pageEls = el.querySelectorAll("[data-page-number]");
      pageEls.forEach((pageEl) => io.observe(pageEl));
    };

    // Re-observe when DOM children change (placeholder ↔ PdfPage swaps)
    const mo = new MutationObserver(observe);
    mo.observe(el, {
      childList: true,
      subtree: true,
    });
    observe();

    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [totalPages, containerRef, setCurrentPage]);

  // Compute which pages to render based on scroll position
  const estimatedHeight = containerWidth * zoom * A4_RATIO + PAGE_MARGIN;
  const firstVisible = estimatedHeight > 0
    ? Math.max(1, Math.floor(scrollTop / estimatedHeight) + 1)
    : 1;
  const visibleCount = estimatedHeight > 0 && containerHeight > 0
    ? Math.ceil(containerHeight / estimatedHeight) + 1
    : 3;
  const renderStart = Math.max(1, firstVisible - BUFFER_PAGES);
  const renderEnd = Math.min(totalPages, firstVisible + visibleCount - 1 + BUFFER_PAGES);

  return (
    <div ref={containerRef} className="flex-1 overflow-auto bg-muted/30 p-6">
      <div className="mx-auto flex flex-col items-center">
        {loading && !loadError && (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            <p className="text-sm text-muted-foreground">Loading PDF...</p>
          </div>
        )}
        {loadError && (
          <p className="text-destructive text-sm">
            Failed to load document. Please try again.
          </p>
        )}
        {containerWidth > 0 && (
          <Document
            file={url}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(err) => setLoadError(err)}
            onItemClick={() => {/* suppress internal-link navigation — handled by useCitationClick */}}
          >
            {Array.from({ length: totalPages }, (_, i) => {
              const pageNumber = i + 1;
              if (pageNumber >= renderStart && pageNumber <= renderEnd) {
                return (
                  <PdfPage
                    key={pageNumber}
                    pageNumber={pageNumber}
                    width={containerWidth}
                    zoom={zoom}
                    markers={markers.filter((m) => m.pageNumber === pageNumber)}
                    userHighlights={userHighlights.filter((h) => (h.rects ?? []).some((r) => r.page === pageNumber))}
                    hiddenLayerIds={hiddenLayerIds}
                    segments={segments}
                    onExplainClick={onExplainClick}
                  />
                );
              }
              // Placeholder — preserves layout and data-page-number for
              // scroll-to-page and IntersectionObserver tracking
              return (
                <div
                  key={pageNumber}
                  data-page-number={pageNumber}
                  className="mb-4"
                  style={{ height: estimatedHeight, width: containerWidth * zoom }}
                />
              );
            })}
          </Document>
        )}
      </div>
    </div>
  );
}
