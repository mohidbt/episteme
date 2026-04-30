// @vitest-environment jsdom
// G17 — ReferencesView (toggle + list view + AI fill).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: () => {} }),
}));
vi.mock("sonner", () => ({
  toast: { error: () => {}, success: () => {}, message: () => {} },
}));

import { ReferencesView } from "./ReferencesView";
import type { ReferenceRow } from "@/lib/references-server";

const fetchMock = vi.fn();
const NOW = new Date();

const rows: ReferenceRow[] = [
  {
    id: "r1",
    libraryId: 1,
    userId: "u1",
    folderPath: "",
    folderId: null,
    prevFolderId: null,
    citationKey: "smith2020",
    cslJson: { id: "r1", type: "article-journal" },
    paperId: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
] as unknown as ReferenceRow[];

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  refreshMock.mockReset();
  globalThis.confirm = vi.fn(() => true);
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe("ReferencesView", () => {
  it("defaults to list view and renders all enumerated columns", () => {
    render(<ReferencesView rows={rows} />);
    for (const header of [
      "Citation key",
      "Title",
      "Authors",
      "Year",
      "DOI",
      "Venue",
      "Folder",
    ]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    }
  });

  it("toggles to grid view", async () => {
    render(<ReferencesView rows={rows} />);
    expect(screen.queryByRole("table")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId("refs-view-grid"));
    });
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("per-row AI fill posts known + missing for the reference", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ suggestions: { title: "T" } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    render(<ReferencesView rows={rows} />);
    const row = screen.getByTestId("refs-row-r1");
    const btn = row.querySelector('[data-testid="ai-fill-button"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(btn);
    });

    const [aiUrl, aiInit] = fetchMock.mock.calls[0]!;
    expect(String(aiUrl)).toBe("/api/ai-fill");
    const sent = JSON.parse((aiInit as RequestInit).body as string);
    expect(sent.kind).toBe("reference");
    expect(sent.known).toEqual({ citationKey: "smith2020" });
    expect(sent.missing).toEqual(["title", "authors", "year", "doi", "venue"]);

    const [patchUrl] = fetchMock.mock.calls[1]!;
    expect(String(patchUrl)).toBe("/api/references/r1");
  });
});
