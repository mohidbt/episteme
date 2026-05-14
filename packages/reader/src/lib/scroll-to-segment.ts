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
