import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useChat } from "../use-chat";
import type { ViewportContext } from "../use-viewport-tracking";

function sseResponse(events: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(ctrl) {
        for (const e of events) ctrl.enqueue(enc.encode(e));
        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
        ctrl.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

const viewport: ViewportContext = {
  page: 1,
  visiblePages: [1],
  scrollPosition: 0,
} as unknown as ViewportContext;

describe("useChat SSE parsing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("flips assistant message kind to auto-highlight-result on highlight_done and fires onHighlightsChanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sse({ type: "sources", sources: [], conversationId: 7 }),
          sse({ type: "token", content: "Hi" }),
          sse({ type: "highlight_progress", step: "semantic_search", label: "Searching…" }),
          sse({ type: "highlight_progress", step: "create_highlights", label: "Creating highlights…" }),
          sse({ type: "highlight_done", runId: "run-xyz", count: 4 }),
        ]),
      ),
    );

    const onHighlightsChanged = vi.fn();
    const { result } = renderHook(() => useChat(1, { onHighlightsChanged }));
    await act(async () => {
      await result.current.sendMessage("q", viewport);
    });

    await waitFor(() => expect(result.current.streaming).toBe(false));

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.content).toBe("Hi");
    expect(last.kind).toBe("auto-highlight-result");
    expect(last.runId).toBe("run-xyz");
    expect(last.highlightsCount).toBe(4);
    // progressSteps cleared on done (matches slash-command UX; result branch does not render them).
    expect(last.progressSteps).toBeUndefined();
    expect(onHighlightsChanged).toHaveBeenCalledTimes(1);
  });

  it("sets kind to auto-highlight-progress while streaming, before highlight_done arrives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sse({ type: "sources", sources: [] }),
          sse({ type: "highlight_progress", step: "finish" }),
        ]),
      ),
    );

    const { result } = renderHook(() => useChat(1));
    await act(async () => {
      await result.current.sendMessage("q", viewport);
    });
    await waitFor(() => expect(result.current.streaming).toBe(false));

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.kind).toBe("auto-highlight-progress");
    expect(last.progressSteps).toEqual(["finish"]);
  });

  it("prefers detail over label when both present on highlight_progress", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sse({ type: "sources", sources: [] }),
          sse({
            type: "highlight_progress",
            step: "semantic_search",
            label: "Reading page…",
            detail: "reading page 7",
          }),
        ]),
      ),
    );

    const { result } = renderHook(() => useChat(1));
    await act(async () => {
      await result.current.sendMessage("q", viewport);
    });
    await waitFor(() => expect(result.current.streaming).toBe(false));

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.progressSteps).toEqual(["reading page 7"]);
  });

  it("leaves runId/highlightsCount undefined when stream has only tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sse({ type: "sources", sources: [] }),
          sse({ type: "token", content: "only text" }),
        ]),
      ),
    );

    const { result } = renderHook(() => useChat(1));
    await act(async () => {
      await result.current.sendMessage("q", viewport);
    });
    await waitFor(() => expect(result.current.streaming).toBe(false));

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.content).toBe("only text");
    expect(last.runId).toBeUndefined();
    expect(last.highlightsCount).toBeUndefined();
    expect(last.progressSteps).toBeUndefined();
  });
});
