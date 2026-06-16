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
  /** Retained for compat with existing call-sites; ignored by the hook. */
  open?: boolean;
  initial: EnrichableCitation[];
  /** Step through these snapshots on each onRefetch() call. */
  steps: EnrichableCitation[][];
}

function Harness({ paperId, initial, steps }: HarnessProps) {
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
  // GSD-125: auto-POST removed. Opening the sidebar must NOT trigger
  // /citations/enrich — that path is now driven by the manual "Enrich
  // citations" button in CitationsSidebar.
  it("does NOT POST /enrich on open even with un-enriched DOI refs", async () => {
    render(
      <Harness
        paperId="p-1"
        open={true}
        initial={[unenriched(1), unenriched(2)]}
        steps={[]}
      />,
    );

    // Microtask flush so any pending effect would have queued a POST.
    await act(async () => {
      await Promise.resolve();
    });
    const enrichCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === "string" && url.endsWith("/citations/enrich"),
    );
    expect(enrichCalls.length).toBe(0);
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
