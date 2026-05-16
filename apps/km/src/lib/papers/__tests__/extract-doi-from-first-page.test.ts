import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/openrouter-usage", () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

import { recordUsage } from "@/lib/openrouter-usage";
import { extractDoiFromFirstPage } from "../extract-doi-from-first-page";

function mockOpenRouterResponse(content: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      model: "openai/gpt-5-nano",
      usage: { prompt_tokens: 120, completion_tokens: 8 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("extractDoiFromFirstPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns the DOI when the model emits a valid one", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockOpenRouterResponse("10.1234/abc.5678"),
    );
    const out = await extractDoiFromFirstPage("First page text", {
      openrouterKey: "sk-or-test",
      userId: "u1",
    });
    expect(out).toBe("10.1234/abc.5678");
  });

  it("returns null when the model output fails DOI regex validation", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockOpenRouterResponse("not a doi at all"),
    );
    const out = await extractDoiFromFirstPage("Page text", {
      openrouterKey: "sk-or-test",
      userId: "u1",
    });
    expect(out).toBeNull();
  });

  it("returns null on network error without throwing", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("ECONNRESET"));
    const out = await extractDoiFromFirstPage("Page text", {
      openrouterKey: "sk-or-test",
      userId: "u1",
    });
    expect(out).toBeNull();
  });

  it("records usage with source='doi-extract' when fetch succeeds", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockOpenRouterResponse("10.1038/s41586-024-07000-1"),
    );
    await extractDoiFromFirstPage("Page text", {
      openrouterKey: "sk-or-test",
      userId: "user-42",
    });
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-42",
        source: "doi-extract",
        model: "openai/gpt-5-nano",
      }),
    );
  });
});
