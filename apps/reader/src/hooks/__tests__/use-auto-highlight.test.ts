import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { parseHighlightCommand, useAutoHighlight } from "../use-auto-highlight";

describe("parseHighlightCommand", () => {
  it("extracts instruction after the prefix", () => {
    expect(parseHighlightCommand("/highlight loss function")).toEqual({
      matched: true,
      instruction: "loss function",
    });
  });

  it("trims trailing whitespace in the instruction", () => {
    expect(parseHighlightCommand("/highlight   loss function   ")).toEqual({
      matched: true,
      instruction: "loss function",
    });
  });

  it("detects empty instruction", () => {
    expect(parseHighlightCommand("/highlight")).toEqual({
      matched: true,
      instruction: "",
    });
    expect(parseHighlightCommand("/highlight   ")).toEqual({
      matched: true,
      instruction: "",
    });
  });

  it("returns matched:false for non-matching input", () => {
    expect(parseHighlightCommand("hello world")).toEqual({ matched: false });
    expect(parseHighlightCommand("/highlights foo")).toEqual({ matched: false });
  });
});

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      ctrl.close();
    },
  });
}

describe("useAutoHighlight", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("routes run/progress/done events to callbacks", async () => {
    const body = sseStream([
      'data: {"type":"run","runId":"run-123","conversationId":7}\n\n',
      'data: {"type":"progress","step":"semantic_search","detail":"searching: loss"}\n\n',
      'data: {"type":"progress","step":"create_highlights","detail":"creating 3 highlight(s)"}\n\n',
      'data: {"type":"done","summary":"Highlighted 3 passages.","highlightsCount":3}\n\n',
      "data: [DONE]\n\n",
    ]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    );

    const onRun = vi.fn();
    const onProgress = vi.fn();
    const onError = vi.fn();
    const onDone = vi.fn();

    const { result } = renderHook(() => useAutoHighlight(42));

    await act(async () => {
      await result.current.runAutoHighlight("find the loss function", {
        onRun,
        onProgress,
        onError,
        onDone,
      });
    });

    expect(onRun).toHaveBeenCalledWith({ runId: "run-123", conversationId: 7 });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      step: "semantic_search",
      detail: "searching: loss",
    });
    expect(onDone).toHaveBeenCalledWith({
      summary: "Highlighted 3 passages.",
      highlightsCount: 3,
    });
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.running).toBe(false);

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents/42/auto-highlight",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ instruction: "find the loss function" }),
      })
    );
  });

  it("includes conversationId in the request body when provided", async () => {
    const body = sseStream(['data: {"type":"done","summary":"ok","highlightsCount":0}\n\n', "data: [DONE]\n\n"]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(body, { status: 200 })
    );

    const { result } = renderHook(() => useAutoHighlight(1));
    await act(async () => {
      await result.current.runAutoHighlight("x", { conversationId: 9 });
    });
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ instruction: "x", conversationId: 9 });
  });

  it("calls onError when stream emits error event", async () => {
    const body = sseStream([
      'data: {"type":"error","message":"boom"}\n\n',
      "data: [DONE]\n\n",
    ]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(body, { status: 200 })
    );

    const onError = vi.fn();
    const onDone = vi.fn();
    const { result } = renderHook(() => useAutoHighlight(1));
    await act(async () => {
      await result.current.runAutoHighlight("x", { onError, onDone });
    });
    expect(onError).toHaveBeenCalledWith("boom");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("calls onError on HTTP error", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("bad key", { status: 400 })
    );
    const onError = vi.fn();
    const { result } = renderHook(() => useAutoHighlight(1));
    await act(async () => {
      await result.current.runAutoHighlight("x", { onError });
    });
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toMatch(/bad key|HTTP 400/);
  });
});
