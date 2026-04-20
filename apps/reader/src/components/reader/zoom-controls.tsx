"use client";

import { useReaderState } from "@/hooks/use-reader-state";
import { Button } from "@/components/ui/button";

export function ZoomControls() {
  const zoom = useReaderState((s) => s.zoom);
  const zoomIn = useReaderState((s) => s.zoomIn);
  const zoomOut = useReaderState((s) => s.zoomOut);
  const resetZoom = useReaderState((s) => s.resetZoom);

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={zoomOut}>-</Button>
      <span className="w-14 text-center text-sm">{Math.round(zoom * 100)}%</span>
      <Button variant="ghost" size="sm" onClick={zoomIn}>+</Button>
      <Button variant="ghost" size="sm" onClick={resetZoom}>Fit</Button>
    </div>
  );
}
