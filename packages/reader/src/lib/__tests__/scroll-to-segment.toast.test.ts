// @vitest-environment happy-dom
/**
 * A4 — when scrollContainerToSegmentWithRetry exhausts its rAF retry budget
 * trying to locate a target segment, it must surface a user-visible signal by
 * dispatching `episteme:reader-toast` on `window`. KM listens for that event
 * and renders a Sonner error toast. Previously the scroll request failed
 * silently with no feedback.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { scrollContainerToSegmentWithRetry } from "../scroll-to-segment";

describe("scrollContainerToSegmentWithRetry — toast on exhaustion", () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let toastEvents: CustomEvent[];
  let onToast: (e: Event) => void;

  beforeEach(() => {
    // Fire rAF callbacks synchronously so the 30-retry loop runs in the same
    // tick the test invokes the function.
    rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0 as unknown as number;
    });
    toastEvents = [];
    onToast = (e: Event) => {
      toastEvents.push(e as CustomEvent);
    };
    window.addEventListener("episteme:reader-toast", onToast);
  });

  afterEach(() => {
    window.removeEventListener("episteme:reader-toast", onToast);
    rafSpy.mockRestore();
  });

  it("dispatches episteme:reader-toast after 30 failed attempts", () => {
    // Container has no matching page element ⇒ scrollContainerToSegment
    // always returns false ⇒ retry loop will exhaust.
    const container = document.createElement("div");
    document.body.appendChild(container);

    scrollContainerToSegmentWithRetry(container, {
      page: 7,
      bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
    });

    expect(toastEvents).toHaveLength(1);
    expect(toastEvents[0].detail).toMatchObject({ kind: "error" });
    expect(String(toastEvents[0].detail.message)).toMatch(/locate/i);

    document.body.removeChild(container);
  });

  it("does not dispatch a toast on the happy path (bbox resolves first try)", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientHeight", { value: 1000, configurable: true });
    const page = document.createElement("div");
    page.setAttribute("data-page-number", "3");
    page.setAttribute("data-natural-width", "1600");
    page.setAttribute("data-natural-height", "800");
    Object.defineProperty(page, "offsetTop", { value: 2000, configurable: true });
    Object.defineProperty(page, "offsetWidth", { value: 1600, configurable: true });
    container.appendChild(page);
    document.body.appendChild(container);

    scrollContainerToSegmentWithRetry(container, {
      page: 3,
      bbox: { x0: 100, y0: 200, x1: 200, y1: 240 },
    });

    expect(toastEvents).toHaveLength(0);
    expect(container.scrollTop).toBe(2080);

    document.body.removeChild(container);
  });
});
