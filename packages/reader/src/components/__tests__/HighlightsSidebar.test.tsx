import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HighlightsSidebar } from "../HighlightsSidebar";

afterEach(() => cleanup());

const BASE_PROPS = {
  open: true,
  loading: false,
  error: null,
  paperId: "paper-g5",
  userHighlights: [],
};

const LONG_TITLE =
  "This is a very long instruction label that definitely exceeds the previous sixty-character truncation boundary used in HighlightsSidebar";

function makeMultiRectHighlight() {
  return {
    id: "h-1",
    pageNumber: 1,
    textContent: "snippet",
    color: "amber",
    note: null,
    comment: null,
    createdAt: "",
    runId: "run-1",
    toolCallId: null,
    rects: [
      { page: 1, x0: 0, y0: 0, x1: 10, y1: 10 },
      { page: 1, x0: 0, y0: 20, x1: 10, y1: 30 },
      { page: 1, x0: 0, y0: 40, x1: 10, y1: 50 },
    ],
  };
}

describe("G5: AI highlight card", () => {
  it("does not render the misleading 'N highlight(s)' label for a multi-rect single highlight", () => {
    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={[makeMultiRectHighlight()]}
        runs={[{ id: "run-1", instruction: LONG_TITLE, summary: null, highlightCount: 1 }]}
      />,
    );

    // The card must NOT show e.g. "1 highlight" or "3 highlights" — that label
    // counts rows (or rects, depending on read) and is redundant with the
    // explicit "X of Y" rect counter below it.
    expect(screen.queryByText(/\d+\s+highlights?\b/i)).toBeNull();
    // The "X of Y" counter should remain.
    expect(screen.getByText(/1 of 3/)).toBeDefined();
  });

  it("renders the full long title without slicing at 60 chars", () => {
    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={[makeMultiRectHighlight()]}
        runs={[{ id: "run-1", instruction: LONG_TITLE, summary: null, highlightCount: 1 }]}
      />,
    );

    // Full title must appear in the DOM — no slice(0, 60) truncation.
    expect(screen.getByText(LONG_TITLE)).toBeDefined();
  });
});
