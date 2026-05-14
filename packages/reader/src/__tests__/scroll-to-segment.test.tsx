// @vitest-environment happy-dom
/**
 * R6 B4 — scroll PDF viewport so an OCR segment bbox lands in the center.
 *
 * Pure helper that consumes the rendered page's DOM (offsetTop / offsetWidth +
 * the natural width/height carried on data-* attrs from PdfPage) plus the
 * citation bbox in PDF-natural coords, then returns the scrollTop value that
 * centers the bbox inside the container.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  computeSegmentScrollTop,
  scrollContainerToSegment,
} from "../lib/scroll-to-segment";

describe("computeSegmentScrollTop", () => {
  it("centers the bbox vertically in the viewport (PDF y-axis is flipped)", () => {
    // Page is 800pt tall natural, rendered at 1600px wide on a 1600pt-natural
    // page → scale 1.0. Page sits at offsetTop=2000 inside the scroll
    // container. Container is 1000px tall. bbox y0=200, y1=240 (PDF coords,
    // bottom-up) ⇒ CSS top = (800-240)*1 = 560, CSS height = 40, center =
    // 560 + 20 = 580. Final scrollTop = 2000 + 580 - 1000/2 = 2080.
    const out = computeSegmentScrollTop({
      pageOffsetTop: 2000,
      pageDisplayWidth: 1600,
      pageNaturalWidth: 1600,
      pageNaturalHeight: 800,
      bbox: { x0: 100, y0: 200, x1: 200, y1: 240 },
      containerHeight: 1000,
    });
    expect(out).toBe(2080);
  });

  it("clamps negative scroll values to 0", () => {
    const out = computeSegmentScrollTop({
      pageOffsetTop: 0,
      pageDisplayWidth: 800,
      pageNaturalWidth: 800,
      pageNaturalHeight: 1000,
      bbox: { x0: 0, y0: 990, x1: 100, y1: 1000 },
      containerHeight: 1000,
    });
    expect(out).toBe(0);
  });
});

describe("scrollContainerToSegment", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    Object.defineProperty(container, "clientHeight", { value: 1000, configurable: true });

    const page = document.createElement("div");
    page.setAttribute("data-page-number", "3");
    page.setAttribute("data-natural-width", "1600");
    page.setAttribute("data-natural-height", "800");
    Object.defineProperty(page, "offsetTop", { value: 2000, configurable: true });
    Object.defineProperty(page, "offsetWidth", { value: 1600, configurable: true });
    container.appendChild(page);
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("updates scrollTop to center the bbox for the matching page", () => {
    const ok = scrollContainerToSegment(container, {
      page: 3,
      bbox: { x0: 100, y0: 200, x1: 200, y1: 240 },
    });
    expect(ok).toBe(true);
    expect(container.scrollTop).toBe(2080);
  });

  it("returns false when the page DOM is missing (caller can retry)", () => {
    const ok = scrollContainerToSegment(container, {
      page: 99,
      bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
    });
    expect(ok).toBe(false);
  });

  it("returns false when natural dimensions are not yet on the page element", () => {
    const page = container.querySelector('[data-page-number="3"]') as HTMLElement;
    page.removeAttribute("data-natural-width");
    const ok = scrollContainerToSegment(container, {
      page: 3,
      bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
    });
    expect(ok).toBe(false);
  });
});
