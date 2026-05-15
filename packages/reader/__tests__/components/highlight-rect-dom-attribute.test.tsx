import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { UserHighlightLayer, type UserHighlight } from "../../src/components/UserHighlightLayer";

// Bug 2b — multi-rect divs all share the same data-highlight-id, so a
// querySelector by id returns rect 0 even when the caller intended rect N.
// Fix: each rect div must also carry a data-rect-index attribute matching
// its index in the original rects array so callers can disambiguate.
describe("UserHighlightLayer multi-rect data-rect-index (Bug 2b)", () => {
  it("renders data-rect-index for each rect on the page", () => {
    const h: UserHighlight = {
      id: "h-1",
      color: "yellow",
      source: "user",
      layerId: null,
      rects: [
        { page: 1, x0: 10, y0: 100, x1: 50, y1: 110 },
        { page: 1, x0: 60, y0: 200, x1: 120, y1: 220 },
      ],
    };
    const { container } = render(
      <UserHighlightLayer
        highlights={[h]}
        pageNumber={1}
        naturalWidth={612}
        naturalHeight={792}
        displayWidth={612}
      />,
    );
    const overlays = container.querySelectorAll('[data-highlight-id="h-1"]');
    expect(overlays).toHaveLength(2);
    expect(overlays[0].getAttribute("data-rect-index")).toBe("0");
    expect(overlays[1].getAttribute("data-rect-index")).toBe("1");

    const second = container.querySelector(
      '[data-highlight-id="h-1"][data-rect-index="1"]',
    );
    expect(second).not.toBeNull();
  });

  it("preserves original rect index when some rects are on other pages", () => {
    // rect[0] is on page 2, rect[1] on page 1, rect[2] on page 1. When
    // rendering page 1, rect[1] and rect[2] are visible — their data-rect-index
    // must be 1 and 2 (the index in the original h.rects array), NOT 0 and 1.
    // This is critical so that Reader's scroll lookup
    //   [data-highlight-id=X][data-rect-index=N]
    // can find the right rect using the global rect index.
    const h: UserHighlight = {
      id: "h-2",
      color: "yellow",
      source: "user",
      layerId: null,
      rects: [
        { page: 2, x0: 0, y0: 0, x1: 10, y1: 10 },
        { page: 1, x0: 10, y0: 100, x1: 50, y1: 110 },
        { page: 1, x0: 60, y0: 200, x1: 120, y1: 220 },
      ],
    };
    const { container } = render(
      <UserHighlightLayer
        highlights={[h]}
        pageNumber={1}
        naturalWidth={612}
        naturalHeight={792}
        displayWidth={612}
      />,
    );
    const overlays = container.querySelectorAll('[data-highlight-id="h-2"]');
    expect(overlays).toHaveLength(2);
    expect(overlays[0].getAttribute("data-rect-index")).toBe("1");
    expect(overlays[1].getAttribute("data-rect-index")).toBe("2");
  });
});
