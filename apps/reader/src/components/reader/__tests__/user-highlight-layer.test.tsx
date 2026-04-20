import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { UserHighlightLayer, type UserHighlight } from "../user-highlight-layer";

describe("UserHighlightLayer", () => {
  it("renders one overlay per rect on matching page with correct CSS position", () => {
    const h: UserHighlight = {
      id: 1, color: "yellow", source: "user", layerId: null,
      rects: [{ page: 1, x0: 10, y0: 100, x1: 50, y1: 110 }],
    };
    const { container } = render(
      <UserHighlightLayer highlights={[h]} pageNumber={1} naturalWidth={612} naturalHeight={792} displayWidth={612} />
    );
    const overlays = container.querySelectorAll("[data-highlight-id]");
    expect(overlays).toHaveLength(1);
    const style = (overlays[0] as HTMLElement).style;
    expect(style.top).toBe("682px");
    expect(style.left).toBe("10px");
    expect(style.width).toBe("40px");
    expect(style.height).toBe("10px");
  });

  it("filters out rects from other pages", () => {
    const h: UserHighlight = {
      id: 2, color: "blue", source: "user", layerId: null,
      rects: [{ page: 2, x0: 0, y0: 0, x1: 10, y1: 10 }],
    };
    const { container } = render(
      <UserHighlightLayer highlights={[h]} pageNumber={1} naturalWidth={612} naturalHeight={792} displayWidth={612} />
    );
    expect(container.querySelectorAll("[data-highlight-id]")).toHaveLength(0);
  });

  it("hides highlights whose layerId is in hiddenLayerIds", () => {
    const hidden: UserHighlight = {
      id: 3, color: "yellow", source: "ai-auto", layerId: "run-1",
      rects: [{ page: 1, x0: 0, y0: 0, x1: 10, y1: 10 }],
    };
    const visible: UserHighlight = {
      id: 4, color: "yellow", source: "user", layerId: null,
      rects: [{ page: 1, x0: 20, y0: 20, x1: 30, y1: 30 }],
    };
    const { container } = render(
      <UserHighlightLayer
        highlights={[hidden, visible]}
        pageNumber={1}
        naturalWidth={612}
        naturalHeight={792}
        displayWidth={612}
        hiddenLayerIds={new Set(["run-1"])}
      />
    );
    const overlays = container.querySelectorAll("[data-highlight-id]");
    expect(overlays).toHaveLength(1);
    expect(overlays[0].getAttribute("data-highlight-id")).toBe("4");
  });
});
