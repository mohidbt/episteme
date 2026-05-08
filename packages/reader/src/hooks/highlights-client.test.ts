import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHighlights } from "./highlights-client";

describe("highlights-client logging gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("emits debug lifecycle logs in test/dev modes", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ highlights: [{ id: 1 }] }), { status: 200 })),
    );
    const res = await fetchHighlights<{ id: number }>({
      paperId: "p1",
      source: "user",
      url: "/api/user-highlights?paperId=p1",
      signal: new AbortController().signal,
    });
    expect(res.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith("highlights_fetch_start", expect.any(Object));
    expect(spy).toHaveBeenCalledWith("highlights_fetch_success", expect.objectContaining({ count: 1 }));
  });

  it("suppresses debug lifecycle logs in production mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ highlights: [] }), { status: 200 })),
    );
    const res = await fetchHighlights<unknown>({
      paperId: "p1",
      source: "ai",
      url: "/api/paper-highlights?paperId=p1",
      signal: new AbortController().signal,
    });
    expect(res.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
