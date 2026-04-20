import { describe, expect, it } from "vitest";
import { streamPassthrough } from "../stream-passthrough";

describe("streamPassthrough", () => {
  it("mirrors upstream SSE body + content-type", async () => {
    const upstream = new Response(
      new ReadableStream({
        start(ctrl) {
          const enc = new TextEncoder();
          ctrl.enqueue(enc.encode('data: {"type":"token","content":"hi"}\n\n'));
          ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
          ctrl.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    const res = streamPassthrough(upstream);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    const text = await res.text();
    expect(text).toContain('"type":"token"');
    expect(text).toContain("[DONE]");
  });

  it("propagates upstream error status", async () => {
    const upstream = new Response("nope", { status: 502 });
    const res = streamPassthrough(upstream);
    expect(res.status).toBe(502);
  });
});
