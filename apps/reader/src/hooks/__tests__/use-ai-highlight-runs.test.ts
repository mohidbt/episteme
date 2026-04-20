import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAIHighlightRuns } from "../use-ai-highlight-runs";

const RUN_A = {
  id: "run-a",
  instruction: "find loss function",
  status: "completed",
  summary: "done",
  createdAt: "2026-04-17T00:00:00Z",
  completedAt: "2026-04-17T00:00:05Z",
  highlightCount: 3,
};
const RUN_B = {
  id: "run-b",
  instruction: "find methodology",
  status: "completed",
  summary: null,
  createdAt: "2026-04-16T00:00:00Z",
  completedAt: null,
  highlightCount: 1,
};

describe("useAIHighlightRuns", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetches runs for the document", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ runs: [RUN_A, RUN_B] }), { status: 200 })
    );
    const { result } = renderHook(() => useAIHighlightRuns(42));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual([RUN_A, RUN_B]);
    expect(result.current.error).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/documents/42/auto-highlight/runs",
      expect.anything()
    );
  });

  it("toggleRun adds/removes id in hiddenRunIds", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ runs: [RUN_A] }), { status: 200 })
    );
    const { result } = renderHook(() => useAIHighlightRuns(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hiddenRunIds.has("run-a")).toBe(false);
    act(() => {
      result.current.toggleRun("run-a");
    });
    expect(result.current.hiddenRunIds.has("run-a")).toBe(true);
    act(() => {
      result.current.toggleRun("run-a");
    });
    expect(result.current.hiddenRunIds.has("run-a")).toBe(false);
  });

  it("deleteRun calls DELETE, removes from list, invokes callback", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ runs: [RUN_A, RUN_B] }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const onChanged = vi.fn();
    const { result } = renderHook(() => useAIHighlightRuns(7));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteRun("run-a", onChanged);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/documents/7/auto-highlight/runs/run-a",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(result.current.runs.map((r) => r.id)).toEqual(["run-b"]);
    expect(onChanged).toHaveBeenCalled();
  });

  it("refetch re-runs the fetch", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ runs: [RUN_A] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ runs: [RUN_A, RUN_B] }), { status: 200 })
      );
    const { result } = renderHook(() => useAIHighlightRuns(9));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toHaveLength(1);

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.runs).toHaveLength(2);
  });

  it("sets error on HTTP failure", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("err", { status: 500 })
    );
    const { result } = renderHook(() => useAIHighlightRuns(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });
});
