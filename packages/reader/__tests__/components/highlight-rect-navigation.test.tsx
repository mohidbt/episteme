import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HighlightsSidebar } from "../../src/components/HighlightsSidebar";

// Bug 2c — chip Next/Prev only iterates highlights, not the individual rects
// within a highlight. Multi-page highlights (one logical highlight with rects
// on pages [3, 5, 7]) can never iterate to rect 1 or 2 — the consumer always
// jumps to rect 0. The fix is for the sidebar cursor to track
// {highlightIndex, rectIndex} and call onNavigateHighlight(id, rectIndex).

afterEach(() => cleanup());

const BASE_PROPS = {
  open: true,
  loading: false,
  error: null,
  paperId: "paper-multi-rect",
};

describe("HighlightsSidebar rect-aware navigation (Bug 2c)", () => {
  it("Next cycles through each rect of a single multi-rect highlight then wraps", () => {
    const onNavigateHighlight = vi.fn();
    // One AI highlight with three rects on pages 3, 5, 7.
    const highlight = {
      id: "h-multi",
      pageNumber: 3,
      textContent: "spans pages",
      color: "amber",
      note: null,
      comment: null,
      createdAt: "",
      runId: "run-multi",
      toolCallId: null,
      rects: [
        { page: 3, x0: 0, y0: 0, x1: 10, y1: 10 },
        { page: 5, x0: 0, y0: 0, x1: 10, y1: 10 },
        { page: 7, x0: 0, y0: 0, x1: 10, y1: 10 },
      ],
    };
    const runs = [
      { id: "run-multi", instruction: "multi", summary: "multi", highlightCount: 1 },
    ];

    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={[highlight]}
        userHighlights={[]}
        runs={runs}
        onNavigateHighlight={onNavigateHighlight}
      />,
    );

    const next = screen.getByRole("button", { name: "Next highlight" });
    // From (h=0, r=0): clicking Next 3 times should yield rect 1, rect 2, then
    // wrap back to rect 0.
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);

    expect(onNavigateHighlight).toHaveBeenCalledTimes(3);
    // Each call should receive (highlightId, rectIndex).
    expect(onNavigateHighlight.mock.calls[0]).toEqual(["h-multi", 1]);
    expect(onNavigateHighlight.mock.calls[1]).toEqual(["h-multi", 2]);
    expect(onNavigateHighlight.mock.calls[2]).toEqual(["h-multi", 0]);
  });

  it("Next advances rect within highlight then moves to next highlight (rect 0)", () => {
    const onNavigateHighlight = vi.fn();
    const h1 = {
      id: "h-1",
      pageNumber: 1,
      textContent: "first",
      color: "amber",
      note: null,
      comment: null,
      createdAt: "",
      runId: "run-1",
      toolCallId: null,
      rects: [
        { page: 1, x0: 0, y0: 0, x1: 10, y1: 10 },
        { page: 2, x0: 0, y0: 0, x1: 10, y1: 10 },
      ],
    };
    const h2 = {
      id: "h-2",
      pageNumber: 3,
      textContent: "second",
      color: "amber",
      note: null,
      comment: null,
      createdAt: "",
      runId: "run-1",
      toolCallId: null,
      rects: [{ page: 3, x0: 0, y0: 0, x1: 10, y1: 10 }],
    };
    const runs = [
      { id: "run-1", instruction: "x", summary: "x", highlightCount: 2 },
    ];

    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={[h1, h2]}
        userHighlights={[]}
        runs={runs}
        onNavigateHighlight={onNavigateHighlight}
      />,
    );

    const next = screen.getByRole("button", { name: "Next highlight" });
    // Start (h=0, r=0). Next → (h=0, r=1). Next → (h=1, r=0). Next → wrap to (h=0, r=0).
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);

    expect(onNavigateHighlight.mock.calls).toEqual([
      ["h-1", 1],
      ["h-2", 0],
      ["h-1", 0],
    ]);
  });
});
