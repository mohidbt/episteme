import { afterEach, describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExplainPassage } from "../../src/hooks/use-explain-passage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useExplainPassage", () => {
  it("posts to /api/agents/km/invoke with thread_id + message containing page, paperId, and passage text, and calls onOpenPanel", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: null });
    const onOpenPanel = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useExplainPassage({
        paperId: "p1",
        threadId: "t-123",
        onOpenPanel,
      })
    );

    await act(async () => {
      await result.current.explain({ page: 4, text: "the passage" });
    });

    expect(onOpenPanel).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/agents/km/invoke");
    expect(init).toMatchObject({ method: "POST" });
    const body = JSON.parse(init.body as string);
    expect(body.thread_id).toBe("t-123");
    expect(typeof body.message).toBe("string");
    expect(body.message).toContain("the passage");
    expect(body.message).toContain("4");
    expect(body.message).toContain("p1");
  });

  it("throws when threadId is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      useExplainPassage({ paperId: "p1", threadId: null })
    );
    await expect(
      result.current.explain({ page: 1, text: "x" })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
