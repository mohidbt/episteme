// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { PaperActionsButtons } from "./PaperActionsButtons";

const mockFetch = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const paperBase = {
  id: "paper-1",
  title: "Test Paper",
  doi: null as string | null,
  libraryId: 7,
  folderPath: "",
};

describe("PaperActionsButtons", () => {
  it("renders Find citations button", () => {
    render(<PaperActionsButtons paper={paperBase} />);
    expect(screen.getByRole("button", { name: /find citations/i })).toBeTruthy();
  });

  it("POSTs to citations/extract on click and disables while in-flight", async () => {
    let resolveFetch: (v: Response) => void = () => {};
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((res) => {
          resolveFetch = res;
        }),
    );
    render(<PaperActionsButtons paper={paperBase} />);
    const btn = screen.getByRole("button", { name: /find citations/i }) as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/papers/paper-1/citations/extract",
      expect.objectContaining({ method: "POST" }),
    );
    resolveFetch(
      new Response(JSON.stringify({ references: [], stats: {} }), { status: 200 }),
    );
    await waitFor(() => expect(btn.disabled).toBe(false));
  });

  it("does not render Add as reference when paper has no DOI", () => {
    render(<PaperActionsButtons paper={paperBase} />);
    expect(screen.queryByRole("button", { name: /add as reference/i })).toBeNull();
  });

  it("renders Add as reference when paper has a DOI", () => {
    render(
      <PaperActionsButtons paper={{ ...paperBase, doi: "10.1/abc" }} />,
    );
    expect(screen.getByRole("button", { name: /add as reference/i })).toBeTruthy();
  });

  it("POSTs to /api/references with DOI body when Add as reference clicked", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "ref-1" }), { status: 201 }),
    );
    render(
      <PaperActionsButtons paper={{ ...paperBase, doi: "10.1/abc" }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add as reference/i }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/references");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    // BG7: client omits folderPath when paper sits at root ("") so the
    // server derives folder location from paperId. Includes it when truthy.
    expect(body).toEqual({
      doi: "10.1/abc",
      libraryId: 7,
      paperId: "paper-1",
    });
  });

  it("BG7: includes folderPath when paper has a non-root folderPath", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "ref-2" }), { status: 201 }),
    );
    render(
      <PaperActionsButtons
        paper={{ ...paperBase, doi: "10.1/abc", folderPath: "/Bio" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add as reference/i }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      doi: "10.1/abc",
      libraryId: 7,
      paperId: "paper-1",
      folderPath: "/Bio",
    });
  });
});
