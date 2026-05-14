// @vitest-environment happy-dom
/**
 * B6 — useUserHighlights must not surface `source: 'ai-auto'` rows.
 *
 * The server-side GET handler filters them out now, but cached responses or
 * a stale deploy could still slip them through. The hook mirrors the filter
 * defensively so the reader sidebar's User list never duplicates ai-auto
 * rows that already render under the AI run grouping.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

import { useUserHighlights } from "./use-user-highlights";

function Probe({ paperId }: { paperId: string }) {
  const { highlights, userHighlights, loading } = useUserHighlights(paperId);
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="count">{String(highlights.length)}</div>
      <div data-testid="user-overlay-count">{String(userHighlights.length)}</div>
      <ul data-testid="ids">
        {highlights.map((h) => (
          <li key={h.id} data-id={h.id} data-src={h.source ?? "user"}>
            {h.textContent}
          </li>
        ))}
      </ul>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useUserHighlights — source filter", () => {
  it("excludes rows where source === 'ai-auto'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            highlights: [
              {
                id: 1,
                pageNumber: 1,
                textContent: "user note",
                color: "yellow",
                note: null,
                comment: null,
                source: "user",
                rects: null,
                createdAt: new Date().toISOString(),
              },
              {
                id: 2,
                pageNumber: 1,
                textContent: "ai note",
                color: "amber",
                note: "AI",
                comment: null,
                source: "ai-auto",
                rects: null,
                createdAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const ui = render(<Probe paperId="00000000-0000-0000-0000-000000000099" />);
    await waitFor(() => expect(ui.getByTestId("loading").textContent).toBe("false"));

    expect(ui.getByTestId("count").textContent).toBe("1");
    expect(ui.getByTestId("user-overlay-count").textContent).toBe("1");
    const ids = Array.from(
      ui.getByTestId("ids").querySelectorAll("li"),
    ).map((el) => el.getAttribute("data-id"));
    expect(ids).toEqual(["1"]);
  });
});
