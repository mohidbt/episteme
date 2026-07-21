import type { UserHighlight } from "../components/UserHighlightLayer";

export interface HighlightVisibility {
  /** AI-run layerIds to hide. AI highlights carry `layerId`; user highlights don't. */
  hiddenLayerIds: Set<string>;
  /** When true, drop every `source === "user"` highlight (single user toggle). */
  hideAllUser: boolean;
}

/**
 * GSD-227 — pure client-side view filter for reader highlights.
 *
 * Two independent concerns, one pass:
 *   - Per-AI-run hide: an AI run is hidden when its `layerId` is in `hiddenLayerIds`.
 *     (User highlights have `layerId === null`, so this never affects them.)
 *   - All-user hide: when `hideAllUser`, every `source === "user"` highlight is dropped.
 *     User highlights lack a `layerId`, so the layerId filter alone can't hide them —
 *     this toggle is why the filter has to run reader-side before <PdfViewer>.
 *
 * Returns a new array; the input is never mutated.
 */
export function filterVisibleHighlights(
  highlights: UserHighlight[],
  { hiddenLayerIds, hideAllUser }: HighlightVisibility,
): UserHighlight[] {
  return highlights.filter((h) => {
    if (hideAllUser && h.source === "user") return false;
    if (h.layerId && hiddenLayerIds.has(h.layerId)) return false;
    return true;
  });
}
