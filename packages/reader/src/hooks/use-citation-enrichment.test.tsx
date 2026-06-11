// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import {
  CITATION_POLL_DELAYS_MS,
  useCitationEnrichment,
  type EnrichableCitation,
} from "./use-citation-enrichment";

interface HarnessProps {
  paperId: string;
  open: boolean;
  initial: EnrichableCitation[];
  /** Step through these snapshots on each onRefetch() call. */
  steps: EnrichableCitation[][];
}

function Harness({ paperId, open, initial, steps }: HarnessProps) {
  const [citations, setCitations] = useState<EnrichableCitation[]>(initial);
  const stepIdxRef = useRef(0);
  const [enriching, setEnriching] = useState(false);

  const onRefetch = useCallback(() => {
    const i = stepIdxRef.current;
    const next = steps[i];
    if (next) {
      setCitations(next);
      stepIdxRef.current = i + 1;
    }
  }, [steps]);

  useCitationEnrichment({
    paperId,
    open,
    citations,
    onRefetch,
    onEnrichingChange: setEnriching,
  });

  return (
    <div>
      <div data-testid="enriching">{String(enriching)}</div>
      <div data-testid="count">{String(citations.length)}</div>
      <div data-testid="unenriched">
        {String(citations.filter((c) => c.enrichedAt == null && c.doi).length)}
      </div>
    </div>
  );
}

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockImplementation(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function unenriched(id: number): EnrichableCitation {
  return { doi: `10.x/${id}`, enrichedAt: null };
}
function enriched(id: number): EnrichableCitation {
  return { doi: `10.x/${id}`, enrichedAt: new Date().toISOString() };
}

describe("useCitationEnrichment", () => {
  it("POSTs /enrich once when opened with un-enriched DOI refs", async () => {

    render(
      <Harness
        paperId="p-1"
        open={true}
        initial={[unenriched(1), unenriched(2)]}
        steps={[]}
      />,
    );

    // Microtask flush so the effect's POST is queued.
    await act(async () => {
      await Promise.resolve();
    });
    const enrichCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === "string" && url.endsWith("/citations/enrich"),
    );
    expect(enrichCalls.length).toBe(1);
    expect(enrichCalls[0][1]).toMatchObject({ method: "POST" });
  });

  it("does NOT re-POST when sidebar closes + reopens for same paperId", async () => {

    function Wrapper() {
      const [open, setOpen] = useState(true);
      return (
        <div>
          <button data-testid="toggle" onClick={() => setOpen((v) => !v)}>
            toggle
          </button>
          <Harness
            paperId="p-1"
            open={open}
            initial={[unenriched(1)]}
            steps={[]}
          />
        </div>
      );
    }

    const { getByTestId, unmount } = render(<Wrapper />);
    await act(async () => {
      await Promise.resolve();
    });
    let posts = mockFetch.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].endsWith("/citations/enrich"),
    ).length;
    expect(posts).toBe(1);

    // Close + reopen — child Harness unmounts and remounts.
    await act(async () => {
      getByTestId("toggle").click();
    });
    await act(async () => {
      getByTestId("toggle").click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    posts = mockFetch.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].endsWith("/citations/enrich"),
    ).length;
    expect(posts).toBe(1);
    unmount();
  });

  it("polls onRefetch on backoff schedule until all refs enriched, then stops", async () => {
    vi.useFakeTimers();
    // Avoid open=true so the POST .then doesn't race with poll timers — this
    // isolates the polling-loop behaviour. The POST gate is covered in a
    // separate test above.
    const { getByTestId } = render(
      <Harness
        paperId="p-1"
        open={false}
        initial={[unenriched(1), unenriched(2)]}
        steps={[
          // After first poll, still 1 unenriched.
          [enriched(1), unenriched(2)],
          // After second poll, all enriched.
          [enriched(1), enriched(2)],
        ]}
      />,
    );

    expect(getByTestId("enriching").textContent).toBe("true");

    // Advance first poll delay (8s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CITATION_POLL_DELAYS_MS[0] + 100);
    });
    // After 1 poll: 1 unenriched left, still polling.
    expect(getByTestId("unenriched").textContent).toBe("1");
    expect(getByTestId("enriching").textContent).toBe("true");

    // Advance second poll delay (6s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CITATION_POLL_DELAYS_MS[1] + 100);
    });
    expect(getByTestId("unenriched").textContent).toBe("0");
    expect(getByTestId("enriching").textContent).toBe("false");
  });

  it("cleans up timers on unmount — no further refetches", async () => {
    vi.useFakeTimers();

    const refetchCalls: number[] = [];
    function Wrapper() {
      const [citations] = useState<EnrichableCitation[]>([unenriched(1)]);
      const onRefetch = useCallback(() => {
        refetchCalls.push(Date.now());
      }, []);
      useCitationEnrichment({
        paperId: "p-1",
        open: true,
        citations,
        onRefetch,
      });
      return <div data-testid="alive">y</div>;
    }

    const { unmount } = render(<Wrapper />);
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(refetchCalls.length).toBe(0);
  });
});
