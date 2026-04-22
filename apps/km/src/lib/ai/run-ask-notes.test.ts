import { describe, it, expect, vi, afterEach } from "vitest";
import { runAskNotes, type Source } from "./run-ask-notes";

function makeStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runAskNotes", () => {
  it("dispatches sources event before tokens", async () => {
    const order: string[] = [];
    const sources: Source[] = [];
    const tokens: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        makeStreamResponse([
          'data: {"type":"sources","notes":[{"id":"n1","title":"A","slug":"a","snippet":"s"}]}\n\n',
          'data: {"type":"token","content":"Hello"}\n\n',
          'data: {"type":"token","content":" world"}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );

    await runAskNotes({
      question: "q",
      history: [],
      onSources: (notes) => {
        order.push("sources");
        sources.push(...notes);
      },
      onToken: (t) => {
        order.push("token");
        tokens.push(t);
      },
    });

    expect(order).toEqual(["sources", "token", "token"]);
    expect(sources).toEqual([{ id: "n1", title: "A", slug: "a", snippet: "s" }]);
    expect(tokens).toEqual(["Hello", " world"]);
  });

  it("handles split chunks across fetch boundaries", async () => {
    const tokens: string[] = [];
    const srcs: Source[] = [];
    const chunks = [
      'data: {"type":"sour',
      'ces","notes":[]}\n\ndata: {"type":"token","con',
      'tent":"hi"}\n\ndata: [DONE]\n\n',
    ];
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    );

    await runAskNotes({
      question: "q",
      history: [],
      onSources: (notes) => {
        srcs.push(...notes);
      },
      onToken: (t) => tokens.push(t),
    });

    expect(srcs).toEqual([]);
    expect(tokens).toEqual(["hi"]);
  });

  it("silent on AbortError (onError not called)", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSources = vi.fn();
    const onToken = vi.fn();
    const onError = vi.fn();
    const promise = runAskNotes({
      question: "q",
      history: [],
      signal: controller.signal,
      onSources,
      onToken,
      onError,
    });

    controller.abort();
    await promise;

    expect(onToken).not.toHaveBeenCalled();
    expect(onSources).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onError on error event", async () => {
    let err: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        makeStreamResponse([
          'data: {"type":"error","message":"boom"}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );

    await runAskNotes({
      question: "q",
      history: [],
      onSources: () => {},
      onToken: () => {},
      onError: (m) => {
        err = m;
      },
    });

    expect(err).toBe("boom");
  });

  it("sends {question, history} as JSON body", async () => {
    let capturedBody: string | null = null;
    let capturedUrl: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = typeof url === "string" ? url : String(url);
        capturedBody = (init?.body as string) ?? null;
        return makeStreamResponse(["data: [DONE]\n\n"]);
      }),
    );

    const history = [
      { role: "user" as const, content: "prev q" },
      { role: "assistant" as const, content: "prev a" },
    ];
    await runAskNotes({
      question: "hi",
      history,
      onSources: () => {},
      onToken: () => {},
    });

    expect(capturedUrl).toBe("/api/ai/chat");
    expect(capturedBody).toBe(
      JSON.stringify({ question: "hi", history }),
    );
  });

  it("handles empty sources (notes:[]) and proceeds to tokens", async () => {
    const srcs: Source[][] = [];
    const tokens: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        makeStreamResponse([
          'data: {"type":"sources","notes":[]}\n\n',
          'data: {"type":"token","content":"nothing found"}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );

    await runAskNotes({
      question: "q",
      history: [],
      onSources: (n) => srcs.push(n),
      onToken: (t) => tokens.push(t),
    });

    expect(srcs).toEqual([[]]);
    expect(tokens).toEqual(["nothing found"]);
  });
});
