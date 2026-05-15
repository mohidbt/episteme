import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { usePaperHighlights } from "./use-paper-highlights";

function Probe({ paperId }: { paperId: string }) {
  const { loading, error, highlights } = usePaperHighlights(paperId);
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="error">{error ?? ""}</div>
      <div data-testid="count">{String(highlights.length)}</div>
    </div>
  );
}

describe("usePaperHighlights", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("recovers from initial auth failure on retry", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        return new Response(
          JSON.stringify({
            highlights: [{ id: "a1", page: 1, bbox: null, color: "amber", noteMd: null, createdAt: new Date().toISOString() }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const ui = render(<Probe paperId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => expect(ui.getByTestId("error").textContent).toBe("Failed to load AI highlights"));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => {
      expect(ui.getByTestId("error").textContent).toBe("");
      expect(ui.getByTestId("count").textContent).toBe("1");
    });
  });

  // Codex R-E Important 3 — dedup + userHighlight mapping should be memoized
  // against state.data so downstream memo deps (UserHighlightLayer etc.) don't
  // invalidate every parent rerender.
  it("returns stable `highlights` and `userHighlights` references when underlying data is unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              highlights: [
                {
                  id: "a1",
                  page: 1,
                  bbox: { x0: 10, y0: 20, x1: 100, y1: 40, page: 1 },
                  color: "amber",
                  noteMd: null,
                  runId: "r1",
                  createdAt: new Date().toISOString(),
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const seen: Array<{ h: unknown; u: unknown }> = [];
    let force: (() => void) | null = null;
    function MemoProbe() {
      const [, setN] = useState(0);
      force = () => setN((n) => n + 1);
      const { highlights, userHighlights, loading } = usePaperHighlights(
        "00000000-0000-0000-0000-000000000002",
      );
      if (!loading) seen.push({ h: highlights, u: userHighlights });
      return <div data-testid="loading">{String(loading)}</div>;
    }

    const ui = render(<MemoProbe />);
    await waitFor(() => expect(ui.getByTestId("loading").textContent).toBe("false"));
    expect(seen.length).toBeGreaterThanOrEqual(1);
    const first = seen[seen.length - 1];

    act(() => {
      force?.();
    });
    act(() => {
      force?.();
    });

    const last = seen[seen.length - 1];
    expect(last.h).toBe(first.h);
    expect(last.u).toBe(first.u);
  });
});
