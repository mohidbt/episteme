import { describe, it, expect } from "vitest";
import { pickCurrentPageFromEntries } from "../../src/components/pdf-viewer-io";

/**
 * Bug 1 (page-counter flicker) — Round C.
 *
 * Root cause: IntersectionObserver.disconnect() + re-observe does NOT flush
 * pending IO callbacks. Stale entries from before the disconnect arrive AFTER
 * reconnect → conflicting setCurrentPage() calls → counter oscillates
 * "3 → 4 → 3 → 4" during fast swipe.
 *
 * Fix: tag each IO callback with the generation at which it was created. The
 * callback compares its captured generation to the current generation; if
 * stale, it returns null and the caller skips setCurrentPage.
 */

type MockEntry = {
  intersectionRatio: number;
  target: { dataset: { pageNumber: string } };
};

function mkEntry(pageNumber: number, ratio: number): MockEntry {
  return {
    intersectionRatio: ratio,
    target: { dataset: { pageNumber: String(pageNumber) } },
  };
}

describe("pickCurrentPageFromEntries (Bug 1 generation guard)", () => {
  it("returns null when the callback's generation is stale", () => {
    // Callback was bound at gen 1, but current generation has advanced to 2.
    // Entries arriving from the old observer must be ignored.
    const entries = [mkEntry(3, 0.9)];
    const result = pickCurrentPageFromEntries(
      entries as unknown as IntersectionObserverEntry[],
      /* callbackGen */ 1,
      /* currentGen  */ 2
    );
    expect(result).toBeNull();
  });

  it("returns the highest-ratio page when the generation matches", () => {
    const entries = [mkEntry(3, 0.3), mkEntry(4, 0.8)];
    const result = pickCurrentPageFromEntries(
      entries as unknown as IntersectionObserverEntry[],
      /* callbackGen */ 5,
      /* currentGen  */ 5
    );
    expect(result).toBe(4);
  });

  it("does not regress to a lower-ratio page within a single batch", () => {
    // Fast-swipe simulation: page 4 dominates; entries for page 3 are lower
    // ratio. Helper must pick 4, not 3, regardless of entry order.
    const entries = [mkEntry(4, 0.85), mkEntry(3, 0.40)];
    const result = pickCurrentPageFromEntries(
      entries as unknown as IntersectionObserverEntry[],
      1,
      1
    );
    expect(result).toBe(4);
  });

  it("returns null when no entry has a positive intersection ratio", () => {
    const entries = [mkEntry(2, 0), mkEntry(3, 0)];
    const result = pickCurrentPageFromEntries(
      entries as unknown as IntersectionObserverEntry[],
      1,
      1
    );
    expect(result).toBeNull();
  });
});
