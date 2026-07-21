import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { HighlightsSidebar } from "../HighlightsSidebar";

afterEach(() => cleanup());

const BASE_PROPS = {
  open: true,
  loading: false,
  error: null,
  paperId: "paper-227",
  userHighlights: [],
};

function aiHighlight(id: string, runId: string | null) {
  return {
    id,
    pageNumber: 1,
    textContent: "snippet",
    color: "amber",
    note: null,
    comment: null,
    createdAt: "",
    runId,
    toolCallId: null,
    rects: [{ page: 1, x0: 0, y0: 0, x1: 10, y1: 10 }],
  };
}

describe("GSD-227: per-run visibility toggle", () => {
  it("calls onToggleRunVisibility with the run id when the run eye toggle is clicked", () => {
    const onToggleRunVisibility = vi.fn();
    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={[aiHighlight("h-1", "run-1")]}
        runs={[{ id: "run-1", instruction: "Find claims", summary: null, highlightCount: 1 }]}
        hiddenRunLayerIds={new Set()}
        onToggleRunVisibility={onToggleRunVisibility}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /hide highlight run/i }));
    expect(onToggleRunVisibility).toHaveBeenCalledWith("run-1");
  });

  it("shows a 'Show highlight run' affordance when the run is hidden", () => {
    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={[aiHighlight("h-1", "run-1")]}
        runs={[{ id: "run-1", instruction: "Find claims", summary: null, highlightCount: 1 }]}
        hiddenRunLayerIds={new Set(["run-1"])}
        onToggleRunVisibility={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /show highlight run/i })).toBeDefined();
  });
});

describe("GSD-227: single all-user toggle", () => {
  it("calls onToggleAllUserHighlights when the user-segment eye toggle is clicked", () => {
    const onToggleAllUserHighlights = vi.fn();
    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={[]}
        userHighlights={[
          {
            id: 1,
            pageNumber: 1,
            textContent: "user snippet",
            color: "yellow",
            note: null,
            comment: null,
            createdAt: "",
          },
        ]}
        hideAllUserHighlights={false}
        onToggleAllUserHighlights={onToggleAllUserHighlights}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /hide all user highlights/i }));
    expect(onToggleAllUserHighlights).toHaveBeenCalledTimes(1);
  });

  it("shows a 'Show all user highlights' affordance when user highlights are hidden", () => {
    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={[]}
        userHighlights={[
          {
            id: 1,
            pageNumber: 1,
            textContent: "user snippet",
            color: "yellow",
            note: null,
            comment: null,
            createdAt: "",
          },
        ]}
        hideAllUserHighlights={true}
        onToggleAllUserHighlights={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /show all user highlights/i })).toBeDefined();
  });
});
