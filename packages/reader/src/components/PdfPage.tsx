"use client";

import { memo, useState } from "react";
import { Page } from "react-pdf";
import { HighlightLayer } from "./HighlightLayer";
import { UserHighlightLayer, type UserHighlight } from "./UserHighlightLayer";
import type { MarkerRect } from "./PdfViewer";

interface PdfPageProps {
  pageNumber: number;
  width: number;
  /** Live zoom — drives the cheap CSS transform during wheel gestures. */
  zoom: number;
  /**
   * Committed zoom — drives the PDF.js canvas rasterization width. Lags
   * `zoom` during rapid wheel/pinch input and catches up after a debounced
   * idle window (set by PdfViewer). Decoupling these is the GSD-25 fix:
   * canvas re-render is expensive (~50ms per page on retina), CSS scale is
   * compositor-only (~0ms).
   */
  renderZoom: number;
  markers?: MarkerRect[];
  userHighlights?: UserHighlight[];
  hiddenLayerIds?: Set<string>;
}

export const PdfPage = memo(function PdfPage({
  pageNumber,
  width,
  zoom,
  renderZoom,
  markers = [],
  userHighlights,
  hiddenLayerIds,
}: PdfPageProps) {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  // Canvas is rasterized at the committed `renderZoom`. The live `zoom`
  // applies as a CSS transform — instant, GPU-composited, no re-render.
  const renderWidth = width * renderZoom;
  const cssScale = renderZoom === 0 ? 1 : zoom / renderZoom;
  const transform = cssScale === 1 ? undefined : `scale(${cssScale})`;
  // Reserve layout space at the post-transform size so neighboring pages
  // and the scroll container account for the live scale, not the canvas
  // pixel size.
  const displayWidth = renderWidth * cssScale;
  const displayHeight = naturalSize
    ? (naturalSize.height * renderWidth) / naturalSize.width * cssScale
    : undefined;

  return (
    <div
      data-page-number={pageNumber}
      data-natural-width={naturalSize?.width}
      data-natural-height={naturalSize?.height}
      className="relative mb-4"
      style={{
        width: displayWidth,
        height: displayHeight,
      }}
    >
      <div
        className="shadow-md"
        style={{
          transform,
          transformOrigin: "top left",
          width: renderWidth,
        }}
      >
        <Page
          pageNumber={pageNumber}
          width={renderWidth}
          renderTextLayer={true}
          renderAnnotationLayer={true}
          onLoadSuccess={(page) => {
            const vp = page.getViewport({ scale: 1 });
            setNaturalSize({ width: vp.width, height: vp.height });
          }}
        />
        {naturalSize && markers.length > 0 && (
          <HighlightLayer
            markers={markers}
            naturalWidth={naturalSize.width}
            naturalHeight={naturalSize.height}
            displayWidth={renderWidth}
          />
        )}
        {naturalSize && userHighlights && userHighlights.length > 0 && (
          <UserHighlightLayer
            highlights={userHighlights}
            pageNumber={pageNumber}
            naturalWidth={naturalSize.width}
            naturalHeight={naturalSize.height}
            displayWidth={renderWidth}
            hiddenLayerIds={hiddenLayerIds}
          />
        )}
      </div>
    </div>
  );
});
