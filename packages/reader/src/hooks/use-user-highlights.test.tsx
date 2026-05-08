import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useUserHighlights } from "./use-user-highlights";

function Probe({ paperId }: { paperId: string }) {
  const { loading, error, highlights } = useUserHighlights(paperId);
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="error">{error ?? ""}</div>
      <div data-testid="count">{String(highlights.length)}</div>
    </div>
  );
}

describe("useUserHighlights", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("recovers from transient first-load failure on background revalidation", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            highlights: [
              {
                id: 1,
                pageNumber: 1,
                textContent: "hello",
                color: "yellow",
                note: null,
                comment: null,
                rects: null,
                createdAt: new Date().toISOString(),
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );

    const ui = render(<Probe paperId="00000000-0000-0000-0000-000000000001" />);

    await waitFor(() => {
      expect(ui.getByTestId("error").textContent).toBe("Failed to load highlights");
    });

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(ui.getByTestId("error").textContent).toBe("");
      expect(ui.getByTestId("count").textContent).toBe("1");
      expect(ui.getByTestId("loading").textContent).toBe("false");
    });
    expect(console.debug).toHaveBeenCalledWith(
      "highlights_error_cleared",
      expect.objectContaining({
        paperId: "00000000-0000-0000-0000-000000000001",
        source: "user",
      }),
    );
  });

  it("keeps existing highlights on non-initial refresh failure", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return new Response(
            JSON.stringify({
              highlights: [
                {
                  id: 1,
                  pageNumber: 1,
                  textContent: "hello",
                  color: "yellow",
                  note: null,
                  comment: null,
                  rects: null,
                  createdAt: new Date().toISOString(),
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ error: "down" }), { status: 500 });
      }),
    );

    const ui = render(<Probe paperId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => expect(ui.getByTestId("count").textContent).toBe("1"));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => {
      expect(ui.getByTestId("count").textContent).toBe("1");
      expect(ui.getByTestId("error").textContent).toBe("");
    });
  });

  it("treats non-JSON 200 body as graceful empty fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>ok</html>", { status: 200 })),
    );

    const ui = render(<Probe paperId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => {
      expect(ui.getByTestId("loading").textContent).toBe("false");
      expect(ui.getByTestId("error").textContent).toBe("");
      expect(ui.getByTestId("count").textContent).toBe("0");
    });
  });
});
