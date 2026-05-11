import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useHighlightsResource } from "./use-highlights-resource";
// Tests simulate cross-tab messages by posting from a fresh BroadcastChannel,
// because by spec a channel does NOT deliver messages back to its own sender.

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

  it("refetches when a matching BroadcastChannel event arrives", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ highlights: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const paperId = "00000000-0000-0000-0000-000000000002";
    const ui = render(<Probe paperId={paperId} rerenderTrigger={0} />);
    await waitFor(() => expect(ui.getByTestId("count").textContent).toBe("0"));
    const initialCalls = fetchSpy.mock.calls.length;

    const otherTab = new BroadcastChannel("episteme.highlights");
    otherTab.postMessage({ paperId, source: "user" });

    await waitFor(() => {
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(initialCalls);
    });
    otherTab.close();
  });

  it("ignores BroadcastChannel events for a different paperId or source", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ highlights: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const paperId = "00000000-0000-0000-0000-000000000003";
    const ui = render(<Probe paperId={paperId} rerenderTrigger={0} />);
    await waitFor(() => expect(ui.getByTestId("count").textContent).toBe("0"));
    const initialCalls = fetchSpy.mock.calls.length;

    const otherTab = new BroadcastChannel("episteme.highlights");
    otherTab.postMessage({ paperId: "different-paper", source: "user" });
    otherTab.postMessage({ paperId, source: "ai" });

    // Give any erroneous refetch a chance to fire.
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchSpy.mock.calls.length).toBe(initialCalls);
    otherTab.close();
  });
});
