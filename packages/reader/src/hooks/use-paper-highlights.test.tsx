import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
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
});
