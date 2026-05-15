import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HighlightsSidebar } from "../../src/components/HighlightsSidebar";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAiHighlight(id: number | string, runId: string | null = "run-1") {
  return {
    id,
    pageNumber: 1,
    textContent: `text-${id}`,
    color: "amber",
    note: null,
    comment: null,
    createdAt: "",
    runId,
    toolCallId: null,
  };
}

const BASE_PROPS = {
  open: true,
  loading: false,
  error: null,
  paperId: "paper-chip-ui",
};

afterEach(() => {
  cleanup();
});

// ─── Bug 3a — chip UI redesign ────────────────────────────────────────────────
//
// Format choices (documented):
//   - Secondary line for multi-highlight runs: "{N} highlights"
//   - Counter format: "{i+1} of {N}"

describe("Bug 3a: single-highlight run hides nav controls + suffix", () => {
  it("does not render '(1)' suffix, prev/next buttons, or counter", () => {
    const highlights = [makeAiHighlight(1, "run-1")];
    const runs = [
      { id: "run-1", instruction: "Goal + method summary", summary: "Goal + method summary", highlightCount: 1 },
    ];

    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={highlights}
        userHighlights={[]}
        runs={runs}
      />,
    );

    const chipBtn = screen.getByRole("button", { name: /Goal \+ method summary/i });
    // Title text should not include parenthesized count
    expect(chipBtn.textContent).not.toMatch(/\(\d+\)/);
    // No "1 / 1" or "1 of 1" counter
    expect(chipBtn.textContent).not.toMatch(/1\s*\/\s*1/);
    expect(chipBtn.textContent).not.toMatch(/1\s+of\s+1/);

    // No nav buttons
    expect(screen.queryByRole("button", { name: /Next highlight/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Previous highlight/i })).toBeNull();
  });
});

describe("Bug 3a: single highlight with multi-rects shows '1 highlight' (singular)", () => {
  it("renders '1 highlight' (singular) not '1 highlights' when one logical highlight spans multiple rects", () => {
    const h = {
      ...makeAiHighlight(1, "run-multi-rect"),
      rects: [
        { page: 1, x0: 0, y0: 0, x1: 10, y1: 10 },
        { page: 2, x0: 0, y0: 0, x1: 10, y1: 10 },
      ],
    };
    const runs = [
      { id: "run-multi-rect", instruction: "Cross-page claim", summary: "Cross-page claim", highlightCount: 1 },
    ];

    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={[h]}
        userHighlights={[]}
        runs={runs}
      />,
    );

    const chipBtn = screen.getByRole("button", { name: /Cross-page claim/i });
    expect(chipBtn.textContent).toMatch(/1\s+highlight(?!s)/);
    expect(chipBtn.textContent).not.toMatch(/1\s+highlights/);
    // Counter should still appear because totalRects > 1
    expect(chipBtn.textContent).toMatch(/1\s+of\s+2/);
  });
});

describe("Bug 3a: multi-highlight run shows secondary line + counter", () => {
  it("renders '3 highlights' secondary line and '1 of 3' counter, no '(3)' suffix", () => {
    const highlights = [1, 2, 3].map((i) => makeAiHighlight(i, "run-2"));
    const runs = [
      { id: "run-2", instruction: "Key findings", summary: "Key findings", highlightCount: 3 },
    ];

    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={highlights}
        userHighlights={[]}
        runs={runs}
      />,
    );

    const chipBtn = screen.getByRole("button", { name: /Key findings/i });
    // No "(3)" inline suffix
    expect(chipBtn.textContent).not.toMatch(/\(3\)/);
    // Secondary line: "3 highlights"
    expect(chipBtn.textContent).toMatch(/3\s+highlights/);
    // Counter format: "1 of 3"
    expect(chipBtn.textContent).toMatch(/1\s+of\s+3/);

    // Both nav buttons rendered with aria-labels
    expect(screen.getByRole("button", { name: "Next highlight" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Previous highlight" })).toBeDefined();
  });
});
