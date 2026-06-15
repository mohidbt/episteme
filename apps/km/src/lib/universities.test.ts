// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchUniversities } from "./universities";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("name=mit")) {
        return new Response(
          JSON.stringify([
            { name: "MIT", country: "USA", domains: ["mit.edu"], web_pages: ["http://mit.edu"] },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("name=fail")) {
        return new Response("boom", { status: 500 });
      }
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchUniversities", () => {
  it("returns normalized [{name, country}] for a successful query", async () => {
    const result = await fetchUniversities("mit");
    expect(result).toEqual([{ name: "MIT", country: "USA" }]);
  });

  it("returns [] on HTTP error (caller fallbacks to free-text)", async () => {
    const result = await fetchUniversities("fail");
    expect(result).toEqual([]);
  });

  it("returns [] for empty query without making a network call", async () => {
    const spy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const result = await fetchUniversities("");
    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
