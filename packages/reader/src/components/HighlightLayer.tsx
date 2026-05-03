"use client";

interface CitationMarker {
  id: number;
  markerIndex: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface HighlightLayerProps {
  markers: CitationMarker[];
  naturalWidth: number;
  naturalHeight: number;
  /** Width of the rendered page in CSS pixels (width * zoom) */
  displayWidth: number;
}

export function HighlightLayer({
  markers,
  naturalWidth,
  naturalHeight,
  displayWidth,
}: HighlightLayerProps) {
  const scale = displayWidth / naturalWidth;

  return (
    <div
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      aria-hidden="true"
    >
      {markers.map((marker) => {
        // PDF y-axis is bottom-up; CSS is top-down.
        // y1 is the top of the rect in PDF coords (higher value).
        const cssTop = (naturalHeight - marker.y1) * scale;
        const cssLeft = marker.x0 * scale;
        const cssWidth = (marker.x1 - marker.x0) * scale;
        // PDF annotation rects span the full text line height; the superscript
        // glyph sits in the upper ~55 % of that rect.
        const cssHeight = (marker.y1 - marker.y0) * scale * 0.55;

        return (
          <div
            key={marker.id}
            data-marker-index={marker.markerIndex}
            className="absolute rounded bg-foreground/10 cursor-pointer transition-colors hover:bg-foreground/20"
            style={{
              top: cssTop,
              left: cssLeft,
              width: cssWidth,
              height: cssHeight,
              pointerEvents: "auto",
            }}
          />
        );
      })}
    </div>
  );
}
