/**
 * R6 B4 — scroll the PDF viewport so an OCR segment bbox lands centered.
 *
 * The citation pill in the chat panel emits a structured bbox in the page's
 * PDF-natural coords (the same coord space chandra-ocr returns and
 * HighlightLayer renders from). To center it we need:
 *
 *   1. The rendered page's CSS position inside the scroll container
 *      (`pageEl.offsetTop`) and its rendered width in CSS pixels
 *      (`pageEl.offsetWidth`).
 *   2. The page's natural size — PdfPage sets these as `data-natural-width` /
 *      `data-natural-height` once react-pdf reports the viewport.
 *   3. The bbox in natural coords ({x0,y0,x1,y1}, PDF y-axis is bottom-up).
 *   4. The container's visible height to subtract half of it from the bbox
 *      center, putting the segment in the middle of the viewport.
 *
 * Math mirrors HighlightLayer's overlay placement so a click on a citation
 * lines up with the same rect the OCR highlight overlay would draw.
 */

export interface SegmentBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ComputeScrollInput {
  pageOffsetTop: number;
  pageDisplayWidth: number;
  pageNaturalWidth: number;
  pageNaturalHeight: number;
  bbox: SegmentBbox;
  containerHeight: number;
}

export function computeSegmentScrollTop(input: ComputeScrollInput): number {
  const {
    pageOffsetTop,
    pageDisplayWidth,
    pageNaturalWidth,
    pageNaturalHeight,
    bbox,
    containerHeight,
  } = input;
  if (pageNaturalWidth <= 0 || pageNaturalHeight <= 0) return pageOffsetTop;
  const scale = pageDisplayWidth / pageNaturalWidth;
  // PDF y-axis is bottom-up; CSS top is (naturalHeight - y1) * scale.
  const cssTop = (pageNaturalHeight - bbox.y1) * scale;
  const cssHeight = (bbox.y1 - bbox.y0) * scale;
  const bboxCenter = cssTop + cssHeight / 2;
  const target = pageOffsetTop + bboxCenter - containerHeight / 2;
  return Math.max(0, target);
}

export interface ScrollToSegmentArgs {
  page: number;
  bbox: SegmentBbox;
}

/**
 * Imperative DOM helper used by Reader's reader-jump listener. Returns true
 * when the page was found AND its natural dimensions were available, false
 * otherwise so the caller can retry once the page has rendered.
 */
export function scrollContainerToSegment(
  container: HTMLElement,
  args: ScrollToSegmentArgs,
): boolean {
  const pageEl = container.querySelector<HTMLElement>(
    `[data-page-number="${args.page}"]`,
  );
  if (!pageEl) return false;
  const naturalWidthAttr = pageEl.getAttribute("data-natural-width");
  const naturalHeightAttr = pageEl.getAttribute("data-natural-height");
  if (!naturalWidthAttr || !naturalHeightAttr) return false;
  const pageNaturalWidth = Number(naturalWidthAttr);
  const pageNaturalHeight = Number(naturalHeightAttr);
  if (!Number.isFinite(pageNaturalWidth) || !Number.isFinite(pageNaturalHeight)) {
    return false;
  }
  const target = computeSegmentScrollTop({
    pageOffsetTop: pageEl.offsetTop,
    pageDisplayWidth: pageEl.offsetWidth,
    pageNaturalWidth,
    pageNaturalHeight,
    bbox: args.bbox,
    containerHeight: container.clientHeight,
  });
  container.scrollTop = target;
  return true;
}

export interface ScrollWithRetryOptions {
  /** rAF retry budget. Defaults to 30 (~500ms at 60fps). */
  maxAttempts?: number;
  /** Invoked on successful scroll. */
  onSuccess?: () => void;
}

/**
 * A4 — wraps `scrollContainerToSegment` in a rAF retry loop. If the page DOM
 * (or its natural dimensions) hasn't landed yet, we retry until we either
 * succeed or exhaust the attempt budget. On exhaustion we dispatch
 * `episteme:reader-toast` on `window` so the host app (KM) can surface a
 * user-visible Sonner toast — without it the failed scroll is silent.
 */
export function scrollContainerToSegmentWithRetry(
  container: HTMLElement,
  args: ScrollToSegmentArgs,
  opts: ScrollWithRetryOptions = {},
): void {
  const maxAttempts = opts.maxAttempts ?? 30;
  let attempts = 0;
  const tryScroll = () => {
    attempts += 1;
    const ok = scrollContainerToSegment(container, args);
    if (ok) {
      opts.onSuccess?.();
      return;
    }
    if (attempts < maxAttempts) {
      requestAnimationFrame(tryScroll);
      return;
    }
    // Exhausted — surface a toast so the user knows the jump failed.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("episteme:reader-toast", {
          detail: {
            kind: "error",
            message: "Couldn't locate citation in this document.",
          },
        }),
      );
    }
  };
  requestAnimationFrame(tryScroll);
}
