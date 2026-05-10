import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useHighlightsResource } from "./use-highlights-resource";

function Probe({
  paperId,
  rerenderTrigger,
}: {
  paperId: string;
  rerenderTrigger: number;
}) {
  const { data } = useHighlightsResource<{ id: number }>({
    paperId,
    refreshKey: 0,
    source: "user",
    errorMessage: `err-${rerenderTrigger}`,
    mapRow: (row) => row,
    url: `/api/user-highlights?paperId=${paperId}`,
  });
  return (
    <div>
      <div data-testid="trigger">{rerenderTrigger}</div>
      <div data-testid="count">{data.length}</div>
    </div>
  );
}

describe("useHighlightsResource", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not refetch when only mapRow / errorMessage identities change between renders", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ highlights: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const ui = render(
      <Probe paperId="00000000-0000-0000-0000-000000000001" rerenderTrigger={0} />,
    );
    await waitFor(() => expect(ui.getByTestId("count").textContent).toBe("0"));
    const initialCalls = fetchSpy.mock.calls.length;

    for (let i = 1; i <= 10; i++) {
      ui.rerender(
        <Probe paperId="00000000-0000-0000-0000-000000000001" rerenderTrigger={i} />,
      );
    }

    await waitFor(() => expect(ui.getByTestId("trigger").textContent).toBe("10"));
    expect(fetchSpy.mock.calls.length).toBe(initialCalls);
  });
});
