"use client";

export interface UserHighlight {
  id: number;
  color: "yellow" | "green" | "blue" | "pink" | "orange" | "amber";
  source: "user" | "ai-auto";
  layerId: string | null;
  rects: { page: number; x0: number; y0: number; x1: number; y1: number }[] | null;
}

const COLOR_BG: Record<UserHighlight["color"], string> = {
  yellow: "rgba(250,204,21,0.30)",
  green:  "rgba(74,222,128,0.30)",
  blue:   "rgba(96,165,250,0.30)",
  pink:   "rgba(244,114,182,0.30)",
  orange: "rgba(251,146,60,0.30)",
  amber:  "rgba(245,158,11,0.35)",
};

interface Props {
  highlights: UserHighlight[];
  pageNumber: number;
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  /** Runs (layerId) to hide from rendering. In-memory toggle. */
  hiddenLayerIds?: Set<string>;
}

export function UserHighlightLayer({ highlights, pageNumber, naturalWidth, naturalHeight, displayWidth, hiddenLayerIds }: Props) {
  const scale = displayWidth / naturalWidth;
  const visible = hiddenLayerIds && hiddenLayerIds.size > 0
    ? highlights.filter((h) => !(h.layerId && hiddenLayerIds.has(h.layerId)))
    : highlights;
  // The layer wrapper stays pointer-transparent so drags across empty space
  // still drive text selection on the underlying text layer. Individual
  // highlight rects opt back in so a click on a highlight can be detected
  // via event delegation in the parent (reader-client listens on the scroll
  // container for `[data-highlight-id]` clicks).
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
      {visible.flatMap((h) =>
        (h.rects ?? [])
          .filter((r) => r.page === pageNumber)
          .map((r, idx) => (
            <div
              key={`${h.id}-${idx}`}
              data-highlight-id={h.id}
              className="absolute rounded-sm"
              style={{
                top:    (naturalHeight - r.y1) * scale,
                left:   r.x0 * scale,
                width:  (r.x1 - r.x0) * scale,
                height: (r.y1 - r.y0) * scale,
                background: COLOR_BG[h.color],
                pointerEvents: "auto",
                cursor: "pointer",
              }}
            />
          ))
      )}
    </div>
  );
}
