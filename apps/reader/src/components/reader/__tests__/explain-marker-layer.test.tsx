import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { ExplainMarkerLayer, type ExplainSegment } from "../explain-marker-layer";

afterEach(() => cleanup());

const BASE_PROPS = {
  naturalWidth: 400,
  naturalHeight: 800,
  displayWidth: 800, // scale = 2
};

function seg(overrides: Partial<ExplainSegment> & Pick<ExplainSegment, "id" | "kind">): ExplainSegment {
  // bbox values are 0..1 fractions (see chandra_segments.py).
  return {
    page: 0,
    bbox: { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.3125 },
    ...overrides,
  };
}

describe("ExplainMarkerLayer", () => {
  it("renders one marker per renderable segment", () => {
    const segments: ExplainSegment[] = [
      seg({ id: 1, kind: "section_header" }),
      seg({ id: 2, kind: "figure" }),
      seg({ id: 3, kind: "formula" }),
    ];
    const { getAllByRole } = render(
      <ExplainMarkerLayer segments={segments} {...BASE_PROPS} />
    );
    expect(getAllByRole("button")).toHaveLength(3);
  });

  it("drops paragraph and table segments (defensive filter)", () => {
    // Cast to bypass TS — parent is expected to filter, but component must be defensive
    const segments = [
      seg({ id: 1, kind: "section_header" }),
      { id: 2, page: 0, kind: "paragraph", bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
      { id: 3, page: 0, kind: "table", bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
    ] as ExplainSegment[];
    const { getAllByRole } = render(
      <ExplainMarkerLayer segments={segments} {...BASE_PROPS} />
    );
    expect(getAllByRole("button")).toHaveLength(1);
  });

  it("renders section_header marker with correct aria-label", () => {
    const { getByLabelText } = render(
      <ExplainMarkerLayer segments={[seg({ id: 1, kind: "section_header" })]} {...BASE_PROPS} />
    );
    expect(getByLabelText("Explain section heading")).toBeTruthy();
  });

  it("renders figure marker with correct aria-label", () => {
    const { getByLabelText } = render(
      <ExplainMarkerLayer segments={[seg({ id: 2, kind: "figure" })]} {...BASE_PROPS} />
    );
    expect(getByLabelText("Explain figure")).toBeTruthy();
  });

  it("renders formula marker with correct aria-label", () => {
    const { getByLabelText } = render(
      <ExplainMarkerLayer segments={[seg({ id: 3, kind: "formula" })]} {...BASE_PROPS} />
    );
    expect(getByLabelText("Explain formula")).toBeTruthy();
  });

  it("positions marker at bbox.x1 * displayWidth + 4 left, bbox.y0 * displayHeight top", () => {
    // bbox fractions: {x0:0.25, y0:0.25, x1:0.75, y1:0.3125}
    // displayWidth=800, naturalWidth=400, naturalHeight=800 → displayHeight = 800 * (800/400) = 1600
    // left = 0.75 * 800 + 4 = 604
    // top  = 0.25 * 1600 = 400
    const { getByTestId } = render(
      <ExplainMarkerLayer segments={[seg({ id: 7, kind: "section_header" })]} {...BASE_PROPS} />
    );
    const el = getByTestId("explain-marker-7") as HTMLElement;
    expect(el.style.left).toBe("604px");
    expect(el.style.top).toBe("400px");
  });

  it("calls onMarkerClick with segment id on click", () => {
    const onClick = vi.fn();
    const { getByTestId } = render(
      <ExplainMarkerLayer
        segments={[seg({ id: 5, kind: "formula" })]}
        {...BASE_PROPS}
        onMarkerClick={onClick}
      />
    );
    fireEvent.click(getByTestId("explain-marker-5"));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledWith(5);
  });

  it("calls onMarkerClick on Enter keydown", () => {
    const onClick = vi.fn();
    const { getByTestId } = render(
      <ExplainMarkerLayer
        segments={[seg({ id: 6, kind: "figure" })]}
        {...BASE_PROPS}
        onMarkerClick={onClick}
      />
    );
    fireEvent.keyDown(getByTestId("explain-marker-6"), { key: "Enter" });
    expect(onClick).toHaveBeenCalledWith(6);
  });

  it("calls onMarkerClick on Space keydown", () => {
    const onClick = vi.fn();
    const { getByTestId } = render(
      <ExplainMarkerLayer
        segments={[seg({ id: 6, kind: "figure" })]}
        {...BASE_PROPS}
        onMarkerClick={onClick}
      />
    );
    fireEvent.keyDown(getByTestId("explain-marker-6"), { key: " " });
    expect(onClick).toHaveBeenCalledWith(6);
  });

  it("renders outer wrapper with data-testid explain-marker-layer", () => {
    const { getByTestId } = render(
      <ExplainMarkerLayer segments={[]} {...BASE_PROPS} />
    );
    expect(getByTestId("explain-marker-layer")).toBeTruthy();
  });
});
