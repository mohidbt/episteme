// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import React from "react";
import { CitationTypeahead } from "./CitationTypeahead";

describe("CitationTypeahead", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shows placeholder when query is empty", () => {
    const onSelect = vi.fn();
    render(<CitationTypeahead query="" onSelect={onSelect} ref={null} />);
    expect(screen.getByText(/type to search/i)).toBeTruthy();
  });

  it("calls /api/citations/search with debounce when query is non-empty", async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 1,
          citekey: "vaswani2017",
          title: "Attention Is All You Need",
          authors: [{ name: "Vaswani, Ashish" }],
          year: "2017",
          doi: null,
        },
      ],
    });
    vi.stubGlobal("fetch", mockFetch);

    const onSelect = vi.fn();
    render(<CitationTypeahead query="attention" onSelect={onSelect} ref={null} />);

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/citations/search?q=attention"),
    );
  });

  it("displays results after fetch resolves", async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 1,
          citekey: "vaswani2017",
          title: "Attention Is All You Need",
          authors: [{ name: "Vaswani, Ashish" }],
          year: "2017",
          doi: null,
        },
      ],
    });
    vi.stubGlobal("fetch", mockFetch);

    const onSelect = vi.fn();
    render(<CitationTypeahead query="attention" onSelect={onSelect} ref={null} />);

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Attention Is All You Need")).toBeTruthy();
  });
});
