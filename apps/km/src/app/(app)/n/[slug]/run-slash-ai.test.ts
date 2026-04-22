import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runSlashAi, SLASH_AI_REGEX } from "./run-slash-ai";

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
