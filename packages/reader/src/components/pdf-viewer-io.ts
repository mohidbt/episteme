/**
 * Pure helper for PdfViewer's IntersectionObserver callback.
 *
 * Bug 1 (page-counter flicker) root cause: `io.disconnect()` + immediate
 * `io.observe()` does NOT flush IO callbacks already queued in the
 * microtask/task queue. Stale entries delivered after a re-observe can
 * race against fresh entries and cause `setCurrentPage` to oscillate
 * (e.g. "3 → 4 → 3 → 4" during fast swipe near a page boundary).
 *
 * Fix: each time the IO is (re)created, increment a generation counter
 * and capture the value inside the callback closure. On every invocation,
 * compare the captured generation to the current one — if they differ,
 * the callback is stale and must not influence `currentPage`.
 *
 * Returning `null` means "skip — do not call setCurrentPage".
 */
export function pickCurrentPageFromEntries(
  entries: readonly IntersectionObserverEntry[],
  callbackGeneration: number,
  currentGeneration: number
): number | null {
  if (callbackGeneration !== currentGeneration) {
    // Stale entries from a previous observer generation — discard.
    return null;
  }
  let bestRatio = 0;
  let bestPage = 0;
  for (const entry of entries) {
    if (entry.intersectionRatio > bestRatio) {
      bestRatio = entry.intersectionRatio;
      const n = Number((entry.target as HTMLElement).dataset.pageNumber);
      if (Number.isFinite(n)) bestPage = n;
    }
  }
  return bestPage > 0 ? bestPage : null;
}
