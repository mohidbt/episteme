import { describe, it, expect } from "vitest";
import { streamPassthrough } from "./stream-passthrough";

describe("streamPassthrough", () => {
  it("rewrites 402 to stable trial_exhausted JSON regardless of upstream body", async () => {
    const upstream = new Response("any sse-shaped garbage", { status: 402 });
    const res = streamPassthrough(upstream);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "trial_exhausted" });
  });

  // GSD-135: agents-side 404 {"detail": "source_pdf_missing"} must reach the
  // client with its JSON body + Content-Type intact so the UI can switch on
  // the structured code.
  it("passes through agents-side 404 source_pdf_missing JSON body", async () => {
    const upstream = new Response(
      JSON.stringify({ detail: "source_pdf_missing" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
    const res = streamPassthrough(upstream);
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ detail: "source_pdf_missing" });
  });

  it("streams 200 OK as text/event-stream", () => {
    const upstream = new Response("data: hi\n\n", { status: 200 });
    const res = streamPassthrough(upstream);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });
});
