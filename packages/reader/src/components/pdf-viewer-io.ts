/**
 * Pure helper for PdfViewer's IntersectionObserver callback.
 *
 * Bug 1 (stale-generation): `io.disconnect()` + immediate `io.observe()` does
 * NOT flush queued IO callbacks. Stale entries from prior generations are
 * discarded via the generation guard.
 *
 * Bug 2 (page-counter ping-pong "17→18→17→18" on fast scroll): IO callbacks
 * deliver ONLY the entries whose threshold crossed in this batch. Picking max
 * ratio from a single batch is unstable — one batch may include only p17, the
 * next only p18. Fix: keep a persistent `ratioMap` of pageNumber → most
 * recent ratio, update with each entry, then pick max across the whole map.
 *
 * Hysteresis: only switch off the current page when a candidate's ratio
 * exceeds the current page's ratio by more than HYSTERESIS_DELTA. Prevents
 * flutter at the boundary where two pages are near-equally visible.
 *
 * Returning `null` means "skip — do not call setCurrentPage".
 */
const HYSTERESIS_DELTA = 0.08;

export function pickCurrentPageFromEntries(
  entries: readonly IntersectionObserverEntry[],
  callbackGeneration: number,
  currentGeneration: number,
  ratioMap?: Map<number, number>,
  currentPage?: number | null,
): number | null {
  if (callbackGeneration !== currentGeneration) return null;
  for (const entry of entries) {
    const n = Number((entry.target as HTMLElement).dataset.pageNumber);
    if (!Number.isFinite(n)) continue;
    if (ratioMap) {
      ratioMap.set(n, entry.intersectionRatio);
    }
  }
  // No map = legacy callers: fall back to pure batch-max behaviour.
  if (!ratioMap) {
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
  let bestPage = 0;
  let bestRatio = 0;
  for (const [page, ratio] of ratioMap) {
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestPage = page;
    }
  }
  if (bestPage === 0) return null;
  if (
    currentPage != null &&
    currentPage !== bestPage &&
    ratioMap.has(currentPage)
  ) {
    const currentRatio = ratioMap.get(currentPage) ?? 0;
    if (bestRatio - currentRatio < HYSTERESIS_DELTA) {
      return currentPage;
    }
  }
  return bestPage;
}
