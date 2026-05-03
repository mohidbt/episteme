"use client";

import { memo, useState } from "react";
import { Page } from "react-pdf";
import { HighlightLayer } from "./HighlightLayer";
import { UserHighlightLayer, type UserHighlight } from "./UserHighlightLayer";
import type { MarkerRect } from "./PdfViewer";

interface PdfPageProps {
  pageNumber: number;
  width: number;
  zoom: number;
  markers?: MarkerRect[];
  userHighlights?: UserHighlight[];
  hiddenLayerIds?: Set<string>;
}

export const PdfPage = memo(function PdfPage({
  pageNumber,
  width,
  zoom,
  markers = [],
  userHighlights,
  hiddenLayerIds,
}: PdfPageProps) {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  const displayWidth = width * zoom;

  return (
    <div
      data-page-number={pageNumber}
      data-natural-width={naturalSize?.width}
      data-natural-height={naturalSize?.height}
      className="relative mb-4 shadow-md"
    >
      <Page
        pageNumber={pageNumber}
        width={displayWidth}
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
          displayWidth={displayWidth}
        />
      )}
      {naturalSize && userHighlights && userHighlights.length > 0 && (
        <UserHighlightLayer
          highlights={userHighlights}
          pageNumber={pageNumber}
          naturalWidth={naturalSize.width}
          naturalHeight={naturalSize.height}
          displayWidth={displayWidth}
          hiddenLayerIds={hiddenLayerIds}
        />
      )}
    </div>
  );
});
