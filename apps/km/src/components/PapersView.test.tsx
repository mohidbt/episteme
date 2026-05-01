// @vitest-environment jsdom
// G17 — PapersView (toggle + list view + AI fill).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: () => {} }),
}));
vi.mock("sonner", () => ({
  toast: { error: () => {}, success: () => {}, message: () => {} },
}));

import { PapersView } from "./PapersView";
import type { PaperRow } from "@/lib/papers-server";

const fetchMock = vi.fn();

const NOW = new Date();
const papers: PaperRow[] = [
  {
    id: "p1",
    libraryId: 1,
    userId: "u1",
    folderPath: "",
    folderId: null,
    prevFolderId: null,
    filename: "attn.pdf",
    storageUrl: null,
    title: null,
    authors: null,
    year: null,
    doi: null,
    venue: null,
    chandraStatus: "pending",
    chandraCompletedAt: null,
    addedAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "p2",
    libraryId: 1,
    userId: "u1",
    folderPath: "",
    folderId: null,
    prevFolderId: null,
    filename: "complete.pdf",
    storageUrl: null,
    title: "Complete paper",
    authors: ["Smith"],
    year: 2020,
    doi: "10.1/x",
    venue: "Nature",
    chandraStatus: "pending",
    chandraCompletedAt: null,
    addedAt: NOW,
    updatedAt: NOW,
  },
];

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  refreshMock.mockReset();
  globalThis.confirm = vi.fn(() => true);
  // start fresh storage
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("PapersView", () => {
  it("renders grid view by default and switches to list view", async () => {
    render(<PapersView papers={papers} />);
    // grid mode: no table headers visible
    expect(screen.queryByRole("table")).toBeNull();
    // switch to list
    await act(async () => {
      fireEvent.click(screen.getByTestId("papers-view-list"));
    });
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("list view renders all enumerated columns", async () => {
    render(<PapersView papers={papers} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("papers-view-list"));
    });
    for (const header of ["Title", "Authors", "Year", "DOI", "Venue", "Folder"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    }
    // both rows render
    expect(screen.getByTestId("papers-row-p1")).toBeTruthy();
    expect(screen.getByTestId("papers-row-p2")).toBeTruthy();
  });

  it("per-row AI fill button posts known fields + missing field names", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ suggestions: { title: "T" } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    render(<PapersView papers={papers} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("papers-view-list"));
    });

    // p1 has all fields missing — its fill button should be enabled
    const row = screen.getByTestId("papers-row-p1");
    const btn = row.querySelector('[data-testid="ai-fill-button"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(btn);
    });

    // first call: /api/ai-fill
    expect(fetchMock).toHaveBeenCalled();
    const [aiUrl, aiInit] = fetchMock.mock.calls[0]!;
    expect(String(aiUrl)).toBe("/api/ai-fill");
    const sent = JSON.parse((aiInit as RequestInit).body as string);
    expect(sent.kind).toBe("paper");
    expect(sent.known).toEqual({ filename: "attn.pdf" });
    expect(sent.missing).toEqual(["title", "authors", "year", "doi", "venue"]);

    // second call: PATCH the paper with returned suggestions
    const [patchUrl, patchInit] = fetchMock.mock.calls[1]!;
    expect(String(patchUrl)).toBe("/api/papers/p1");
    expect((patchInit as RequestInit).method).toBe("PATCH");
  });

  it("batch button targets only rows with missing fields", async () => {
    render(<PapersView papers={papers} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("papers-view-list"));
    });
    // p1 has missing; p2 has none → count = 1
    const btn = screen.getByTestId("ai-fill-batch-button");
    expect(btn.textContent).toContain("Fill all missing (1)");
  });
});
