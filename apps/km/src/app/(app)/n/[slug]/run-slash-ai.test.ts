import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runSlashAi, SLASH_AI_REGEX } from "./run-slash-ai";
import { surfaceTrialExhaustedToast } from "@/lib/trial-exhausted";

// GSD-130 Path A: the note-editor slash-AI surface must route 402
// trial_exhausted through the shared toast helper, NOT the inline
// `[ai error: …]` onError handler. Spy on the helpers.
vi.mock("@/lib/trial-exhausted", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trial-exhausted")>(
    "@/lib/trial-exhausted",
  );
  return {
    ...actual,
    surfaceTrialExhaustedToast: vi.fn(),
  };
});

function makeTrialExhausted402(): Response {
  return new Response(JSON.stringify({ error: "trial_exhausted" }), {
    status: 402,
    headers: { "content-type": "application/json" },
  });
}

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

describe("runSlashAi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    // reset
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.mocked(surfaceTrialExhaustedToast).mockReset();
  });

  it("surfaces the trial-exhausted toast on 402 and does NOT call onError", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeTrialExhausted402(),
    ) as unknown as typeof fetch;

    const onError = vi.fn();
    const onToken = vi.fn();

    await runSlashAi({ prompt: "rephrase this", onToken, onError });

    expect(surfaceTrialExhaustedToast).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onToken).not.toHaveBeenCalled();
  });

  it("keeps inline onError for non-trial errors (e.g. 500)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("boom", { status: 500 }),
    ) as unknown as typeof fetch;

    const onError = vi.fn();

    await runSlashAi({ prompt: "p", onToken: () => {}, onError });

    expect(surfaceTrialExhaustedToast).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("http 500");
  });

  it("parses token events and calls onToken in order", async () => {
    const tokens: string[] = [];
    globalThis.fetch = vi.fn(async () =>
      makeStreamResponse([
        'data: {"type":"token","content":"Hello"}\n\n',
        'data: {"type":"token","content":" world"}\n\n',
        "data: [DONE]\n\n",
      ]),
    ) as unknown as typeof fetch;

    await runSlashAi({
      prompt: "say hi",
      onToken: (t) => tokens.push(t),
      onError: () => {},
    });

    expect(tokens).toEqual(["Hello", " world"]);
  });

  it("halts on error event", async () => {
    const tokens: string[] = [];
    let error: string | null = null;
    globalThis.fetch = vi.fn(async () =>
      makeStreamResponse([
        'data: {"type":"token","content":"first"}\n\n',
        'data: {"type":"error","message":"boom"}\n\n',
        'data: {"type":"token","content":"later"}\n\n',
        "data: [DONE]\n\n",
      ]),
    ) as unknown as typeof fetch;

    await runSlashAi({
      prompt: "p",
      onToken: (t) => tokens.push(t),
      onError: (m) => {
        error = m;
      },
    });

    expect(tokens).toEqual(["first"]);
    expect(error).toBe("boom");
  });

  it("sends {prompt, context} as JSON body", async () => {
    let capturedBody: string | null = null;
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? null;
      return makeStreamResponse(["data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    await runSlashAi({
      prompt: "hi",
      context: "prev paragraph",
      onToken: () => {},
      onError: () => {},
    });

    expect(capturedBody).toBe(JSON.stringify({ prompt: "hi", context: "prev paragraph" }));
  });

  it("works when context is omitted", async () => {
    let capturedBody: string | null = null;
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? null;
      return makeStreamResponse(["data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    await runSlashAi({
      prompt: "hi",
      onToken: () => {},
      onError: () => {},
    });

    expect(capturedBody).toBe(JSON.stringify({ prompt: "hi" }));
  });

  it("handles an SSE event split across two fetch chunks", async () => {
    // First chunk: header + start of JSON
    // Second chunk: end of JSON + \n\n + [DONE]
    const chunks = [
      'data: {"type":"tok',
      'en","content":"hello"}\n\ndata: [DONE]\n\n',
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

    const tokens: string[] = [];
    await runSlashAi({
      prompt: "x",
      onToken: (t) => tokens.push(t),
      onError: () => {
        /* no-op */
      },
    });
    expect(tokens).toEqual(["hello"]);
  });

  it("aborts in-flight fetch when signal is aborted", async () => {
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

    const onToken = vi.fn();
    const onError = vi.fn();
    const promise = runSlashAi({
      prompt: "x",
      onToken,
      onError,
      signal: controller.signal,
    });

    controller.abort();
    await promise;

    // On abort, no tokens should have been emitted
    expect(onToken).not.toHaveBeenCalled();
    // An AbortError should NOT be reported via onError — abort is not a user-facing error
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("SLASH_AI_REGEX", () => {
  it("matches '/ai tell me about X' and captures 'tell me about X'", () => {
    const m = "/ai tell me about X".match(SLASH_AI_REGEX);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("tell me about X");
  });

  it("does NOT match '/ai' alone (no prompt)", () => {
    expect("/ai".match(SLASH_AI_REGEX)).toBeNull();
  });

  it("does NOT match leading-whitespace '  /ai foo'", () => {
    expect("  /ai foo".match(SLASH_AI_REGEX)).toBeNull();
  });
});
