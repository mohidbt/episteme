"use client";
import { useEffect, useRef } from "react";
import { useReaderState } from "./use-reader-state";

export interface ViewportContext {
  page: number;
  scrollPct: number;
}

export function useViewportTracking(containerRef: React.RefObject<HTMLElement | null>): React.RefObject<ViewportContext> {
  const currentPage = useReaderState((s) => s.currentPage);
  const viewportRef = useRef<ViewportContext>({ page: currentPage, scrollPct: 0 });

  // Update page from reader state
  useEffect(() => {
    viewportRef.current.page = currentPage;
  }, [currentPage]);

  // Track scroll percentage
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let timeout: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const scrollPct = el.scrollHeight > el.clientHeight
          ? el.scrollTop / (el.scrollHeight - el.clientHeight)
          : 0;
        viewportRef.current.scrollPct = Math.round(scrollPct * 100) / 100;
      }, 500); // 500ms debounce
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      clearTimeout(timeout);
    };
  }, [containerRef]);

  return viewportRef;
}
