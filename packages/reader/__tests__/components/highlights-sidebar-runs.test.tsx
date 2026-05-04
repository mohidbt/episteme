import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HighlightsSidebar } from "../../src/components/HighlightsSidebar";

afterEach(() => cleanup());

describe("HighlightsSidebar run rows", () => {
  const highlights = [
    { id: 11, pageNumber: 1, textContent: "a", color: "amber", note: null, comment: null, createdAt: "", runId: "run-1", source: "ai-auto" as const },
    { id: 12, pageNumber: 2, textContent: "b", color: "amber", note: null, comment: null, createdAt: "", runId: "run-1", source: "ai-auto" as const },
    { id: 13, pageNumber: 3, textContent: "c", color: "amber", note: null, comment: null, createdAt: "", runId: "run-1", source: "ai-auto" as const },
  ];

  it("clicking arrow on a 3-highlight run cycles through highlights", () => {
    const onNavigateHighlight = vi.fn();
    render(
      <HighlightsSidebar
        open
        highlights={highlights}
        runs={[{ id: "run-1", instruction: "x", summary: "sum", highlightCount: 3 }]}
        loading={false}
        error={null}
        onNavigateHighlight={onNavigateHighlight}
      />,
    );
    const next = screen.getByRole("button", { name: "Next highlight" });
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
    expect(onNavigateHighlight.mock.calls.map((c) => c[0])).toEqual([11, 12, 13]);
  });

  it("clicking row flies to first highlight", () => {
    const onNavigateHighlight = vi.fn();
    render(
      <HighlightsSidebar
        open
        highlights={highlights}
        runs={[{ id: "run-1", instruction: "x", summary: "sum", highlightCount: 3 }]}
        loading={false}
        error={null}
        onNavigateHighlight={onNavigateHighlight}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /sum/i }));
    expect(onNavigateHighlight).toHaveBeenCalledWith(11);
  });
});
