"use client";

import { useEffect, useRef, useState } from "react";

interface PdfDocLike {
  getPage: (n: number) => Promise<PdfPageLike>;
}

interface PdfPageLike {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void>; cancel?: () => void };
}

interface Props {
  pageNumber: number;
  pdfDoc: PdfDocLike | null;
  width?: number;
  onClick: (pageNumber: number) => void;
}

/**
 * Renders a small PDF page thumbnail lazily — only when scrolled into view.
 * Uses an IntersectionObserver to defer the costly canvas render.
 * The drawn canvas is cached on the component (no redraw on scroll).
 */
export function PageThumbnail({ pageNumber, pdfDoc, width = 120, onClick }: Props) {
  const wrapperRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // Observe visibility (lazy render trigger)
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Render the thumbnail once it's visible and pdfDoc is available
  useEffect(() => {
    if (!visible || !pdfDoc || rendered) return;
    let cancelled = false;
    let renderTask: { cancel?: () => void } | null = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = width / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        setSize({ w: viewport.width, h: viewport.height });
        const task = page.render({ canvasContext: ctx, viewport });
        renderTask = task;
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch {
        // ignore — placeholder remains visible
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel?.();
      } catch {
        /* noop */
      }
    };
  }, [visible, pdfDoc, pageNumber, width, rendered]);

  return (
    <button
      ref={wrapperRef}
      data-testid="page-thumb"
      data-page-thumb-number={pageNumber}
      onClick={() => onClick(pageNumber)}
      className="group flex w-full flex-col items-center gap-1 rounded p-1 hover:bg-accent"
      style={{ minHeight: size ? size.h + 24 : Math.round(width * 1.414) + 24 }}
    >
      <div
        className="overflow-hidden rounded border bg-card shadow-sm"
        style={{
          width,
          height: size ? size.h : Math.round(width * 1.414),
        }}
      >
        <canvas ref={canvasRef} className="block" />
      </div>
      <span className="text-[10px] text-muted-foreground">{pageNumber}</span>
    </button>
  );
}
