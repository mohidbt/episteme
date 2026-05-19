import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolvePaperId } from "../semantic-scholar";

const BASE = "https://api.semanticscholar.org/graph/v1/paper";

function mockJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("resolvePaperId — ARXIV: fallback", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DOI: scheme hits → returns paperId without ARXIV retry", async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse(200, { paperId: "abc123" }));

    const id = await resolvePaperId({ id: 1, doi: "10.1234/foo.bar" });

    expect(id).toBe("abc123");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain(`${BASE}/${encodeURIComponent("DOI:10.1234/foo.bar")}`);
  });

  it("DOI 404 on canonical 10.48550/arXiv.X → retries ARXIV: scheme and resolves", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockJsonResponse(404, {}))
      .mockResolvedValueOnce(mockJsonResponse(200, { paperId: "arxiv-pid" }));

    const id = await resolvePaperId({ id: 1, doi: "10.48550/arXiv.1706.03762" });

    expect(id).toBe("arxiv-pid");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toContain(`${BASE}/${encodeURIComponent("ARXIV:1706.03762")}`);
  });

  it("DOI 404 on bare arXiv:X → retries ARXIV: scheme and resolves", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockJsonResponse(404, {}))
      .mockResolvedValueOnce(mockJsonResponse(200, { paperId: "arxiv-pid-2" }));

    const id = await resolvePaperId({ id: 1, doi: "arXiv:2005.11401" });

    expect(id).toBe("arxiv-pid-2");
    expect(fetchSpy.mock.calls[1][0]).toContain(`${BASE}/${encodeURIComponent("ARXIV:2005.11401")}`);
  });

  it("non-arxiv DOI 404 → falls through to title search (no ARXIV retry)", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockJsonResponse(404, {}))
      .mockResolvedValueOnce(mockJsonResponse(200, { data: [{ paperId: "title-pid" }] }));

    const id = await resolvePaperId({ id: 1, doi: "10.1234/notarxiv", title: "Attention Is All You Need" });

    expect(id).toBe("title-pid");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toContain("/search/match?query=");
  });

});
