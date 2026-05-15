import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HighlightsSidebar } from "../../src/components/HighlightsSidebar";

// ─── localStorage mock ────────────────────────────────────────────────────────
// happy-dom provides window.localStorage but its API surface differs slightly.
// We stub it to a simple in-memory map so all tests stay portable.

function makeFakeStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
  };
}

let fakeStorage = makeFakeStorage();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fakeStorage = makeFakeStorage();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAiHighlight(
  id: number | string,
  runId: string | null = "run-1",
  toolCallId: string | null = null,
) {
  return {
    id,
    pageNumber: 1,
    textContent: `text-${id}`,
    color: "amber",
    note: null,
    comment: null,
    createdAt: "",
    source: "ai-auto" as const,
    runId,
    toolCallId,
  };
}

function makeUserHighlight(id: number) {
  return {
    id,
    pageNumber: 2,
    textContent: `user-text-${id}`,
    color: "yellow",
    note: null,
    comment: null,
    createdAt: "",
  };
}

const BASE_PROPS = {
  open: true,
  loading: false,
  error: null,
  paperId: "paper-abc",
};

// ─── G8 Acceptance tests ──────────────────────────────────────────────────────

describe("G8: one tab per run — runId grouping", () => {
  it("1 run with 5 highlights (same runId, 5 different toolCallIds) → exactly ONE tab in AI segment", () => {
    const highlights = [1, 2, 3, 4, 5].map((i) =>
      makeAiHighlight(i, "run-1", `tc-${i}`),
    );
    const runs = [{ id: "run-1", instruction: "Summarise key points", summary: null, highlightCount: 5 }];

    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={highlights}
        userHighlights={[]}
        runs={runs}
      />,
    );

    // AI segment is active by default when runs exist.
    // There should be exactly one run row showing "(5)"
    const runButtons = screen.getAllByRole("button", { name: /Summarise key points/i });
    expect(runButtons).toHaveLength(1);
    expect(runButtons[0].textContent).toMatch(/5\s+highlights/);
  });

  it("3 user highlights + 1 AI run of 2 → segments are isolated, no overlap", () => {
    const aiHighlights = [makeAiHighlight("a1", "run-X"), makeAiHighlight("a2", "run-X")];
    const userHighlights = [makeUserHighlight(10), makeUserHighlight(11), makeUserHighlight(12)];
    const runs = [{ id: "run-X", instruction: "Deep read", summary: null, highlightCount: 2 }];

    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={aiHighlights}
        userHighlights={userHighlights}
        runs={runs}
      />,
    );

    // AI segment active (runs exist). Should show 1 run tab with (2).
    expect(screen.getByRole("button", { name: /Deep read/i }).textContent).toMatch(/2\s+highlights/);
    // User highlights should NOT appear in AI segment.
    expect(screen.queryByText("user-text-10")).toBeNull();

    // Switch to User segment.
    fireEvent.click(screen.getByRole("tab", { name: /^User$/i }));

    // User segment: 3 items, no AI run rows.
    expect(screen.getByText("user-text-10")).toBeDefined();
    expect(screen.getByText("user-text-11")).toBeDefined();
    expect(screen.getByText("user-text-12")).toBeDefined();
    expect(screen.queryByText(/Deep read/)).toBeNull();
  });
});

describe("G8: segment persistence in localStorage", () => {
  it("switching segment writes reader-highlights-segment:<paperId> to localStorage", () => {
    vi.stubGlobal("localStorage", fakeStorage);

    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        paperId="paper-xyz"
        aiHighlights={[makeAiHighlight(1, "run-1")]}
        userHighlights={[makeUserHighlight(99)]}
        runs={[{ id: "run-1", instruction: "x", summary: null, highlightCount: 1 }]}
      />,
    );

    // Switch to User segment.
    fireEvent.click(screen.getByRole("tab", { name: /^User$/i }));
    expect(fakeStorage.getItem("reader-highlights-segment:paper-xyz")).toBe("user");

    // Switch back to AI segment.
    fireEvent.click(screen.getByRole("tab", { name: /^AI$/i }));
    expect(fakeStorage.getItem("reader-highlights-segment:paper-xyz")).toBe("ai");
  });
});

// ─── New coverage (G8 codex review) ──────────────────────────────────────────

describe("G8: edge cases", () => {
  it("paper with no AI runs AND no user highlights → default segment is 'user', localStorage empty", () => {
    vi.stubGlobal("localStorage", fakeStorage);

    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        paperId="paper-empty"
        aiHighlights={[]}
        userHighlights={[]}
        runs={[]}
      />,
    );

    // Default segment should be "user" (no ai runs)
    const userBtn = screen.getByRole("tab", { name: /^User$/i });
    expect(userBtn.getAttribute("aria-pressed")).toBe("true");
    // localStorage should not have been written
    expect(fakeStorage.getItem("reader-highlights-segment:paper-empty")).toBeNull();
  });

  it("3 highlights with runId=null → AI segment shows exactly ONE 'Manual' tab containing 3 items", () => {
    const highlights = [
      makeAiHighlight("n1", null),
      makeAiHighlight("n2", null),
      makeAiHighlight("n3", null),
    ];

    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={highlights}
        userHighlights={[]}
        runs={[]}
      />,
    );

    // AI segment active because there are ai highlights (manual group).
    // Exactly one "Manual AI highlights" row showing (3).
    const manualBtns = screen.getAllByRole("button", { name: /Manual AI highlights/i });
    expect(manualBtns).toHaveLength(1);
    expect(manualBtns[0].textContent).toMatch(/3\s+highlights/);
  });
});

// ─── Existing behaviour (kept passing) ────────────────────────────────────────

describe("HighlightsSidebar run navigation (existing)", () => {
  const highlights = [1, 2, 3].map((i) => makeAiHighlight(i, "run-1"));
  const runs = [{ id: "run-1", instruction: "x", summary: "sum", highlightCount: 3 }];

  it("clicking Next arrow on a 3-highlight run cycles through highlights", () => {
    const onNavigateHighlight = vi.fn();
    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={highlights}
        userHighlights={[]}
        runs={runs}
        onNavigateHighlight={onNavigateHighlight}
      />,
    );
    const next = screen.getByRole("button", { name: "Next highlight" });
    // Start at cursor 0. First click → cursor becomes 1 → navigates to id=2
    // Second click → cursor becomes 2 → navigates to id=3
    // Third click → cursor becomes 0 → navigates to id=1
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
    expect(onNavigateHighlight.mock.calls.map((c) => c[0])).toEqual([2, 3, 1]);
  });

  // ─── Bug 2a — stale closure under rapid clicks ────────────────────────────
  //
  // navigate() reads `runCursors[runId]` directly from the closure, then calls
  // `setRunCursors({ ...prev, [runId]: next })` with a static object. When
  // multiple Next clicks land in the same render pass (no intermediate flush),
  // every click reads the same stale cursor value and only the last setState
  // wins → onNavigateHighlight gets called with duplicate IDs instead of
  // cycling. The fix is to use functional setState so each update reads the
  // latest cursor.
  //
  // happy-dom + React 19 fireEvent.click flushes between clicks, which hides
  // the bug under the existing "cycles through highlights" test above. To
  // expose the bug we batch all three clicks inside a single act() so React
  // sees them as concurrent updates from a single event tick.
  it("rapid Next clicks (batched in one act) still cycle [id2, id3, id1] (Bug 2a)", () => {
    const onNavigateHighlight = vi.fn();
    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={highlights}
        userHighlights={[]}
        runs={runs}
        onNavigateHighlight={onNavigateHighlight}
      />,
    );
    const next = screen.getByRole("button", { name: "Next highlight" });

    // Batch 3 clicks in the same act so React updates them in one render pass.
    // Functional setState must yield [2, 3, 1]; the closure-based current
    // implementation reads stale cursor=0 for all three → [2, 2, 2].
    act(() => {
      next.click();
      next.click();
      next.click();
    });

    expect(onNavigateHighlight.mock.calls.map((c) => c[0])).toEqual([2, 3, 1]);
  });

  it("clicking row flies to first highlight", () => {
    const onNavigateHighlight = vi.fn();
    render(
      <HighlightsSidebar
        {...BASE_PROPS}
        aiHighlights={highlights}
        userHighlights={[]}
        runs={runs}
        onNavigateHighlight={onNavigateHighlight}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /sum/i }));
    // Row click navigates to the first highlight's first rect.
    expect(onNavigateHighlight).toHaveBeenCalledWith(1, 0);
  });
});
