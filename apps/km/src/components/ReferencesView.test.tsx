// @vitest-environment jsdom
// G17 — ReferencesView (toggle + list view + AI fill).
// #101 — Fill all missing: verify suggestions are converted to cslJson before PATCH.
// #113 — Shimmer animation: verify ai-filling class on rows during fill.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";

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

    const [patchUrl, patchInit] = fetchMock.mock.calls[1]!;
    expect(String(patchUrl)).toBe("/api/references/r1");
  });

  // #101 — The PATCH body must contain { cslJson: ... }, NOT raw { title, authors, ... }
  it("#101 per-row AI fill sends cslJson in PATCH body, not raw denormalised fields", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ suggestions: { title: "Deep Learning", year: 2024, doi: "10.1/x" } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "r1" }), { status: 200 }));

    render(<ReferencesView rows={rows} />);
    const btn = screen.getByTestId("ai-fill-button");

    await act(async () => {
      fireEvent.click(btn);
    });

    // Second fetch call is the PATCH
    const [, patchInit] = fetchMock.mock.calls[1]!;
    const patchBody = JSON.parse((patchInit as RequestInit).body as string);

    // Must have cslJson key (not raw title/year/doi)
    expect("cslJson" in patchBody).toBe(true);
    expect("title" in patchBody).toBe(false);
    expect("year" in patchBody).toBe(false);
    expect("doi" in patchBody).toBe(false);

    // cslJson must contain the CSL-formatted fields
    expect(patchBody.cslJson.title).toBe("Deep Learning");
    expect(patchBody.cslJson.issued).toEqual({ "date-parts": [[2024]] });
    expect(patchBody.cslJson.DOI).toBe("10.1/x");
  });

  // #113 — Rows get ai-filling class while fill is in flight
  it("#113 per-row fill: row has ai-filling class while fill is in flight", async () => {
    // First fetch (ai-fill) returns slowly; second (PATCH) resolves fast
    let resolveAiFill!: (v: Response) => void;
    const aiFillPromise = new Promise<Response>((resolve) => { resolveAiFill = resolve; });
    fetchMock
      .mockReturnValueOnce(aiFillPromise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "r1" }), { status: 200 }));

    render(<ReferencesView rows={rows} />);
    const btn = screen.getByTestId("ai-fill-button");
    const row = screen.getByTestId("refs-row-r1");

    // Before clicking, no ai-filling class
    expect(row.classList.contains("ai-filling")).toBe(false);

    await act(async () => {
      fireEvent.click(btn);
    });

    // While the ai-fill request is pending, row should have ai-filling class
    await waitFor(() => {
      expect(row.classList.contains("ai-filling")).toBe(true);
    });

    // Now resolve the ai-fill
    await act(async () => {
      resolveAiFill(
        new Response(
          JSON.stringify({ suggestions: { title: "T" } }),
          { status: 200 },
        ),
      );
    });

    // After fill completes, row should no longer have ai-filling class
    await waitFor(() => {
      expect(row.classList.contains("ai-filling")).toBe(false);
    });
  });

  // #101 batch fill sends cslJson in PATCH body
  it("#101 batch AI fill sends cslJson in PATCH body", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ suggestions: { title: "Batch Paper", venue: "NeurIPS" } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "r1" }), { status: 200 }));

    render(<ReferencesView rows={rows} />);
    const batchBtn = screen.getByTestId("ai-fill-batch-button");

    await act(async () => {
      fireEvent.click(batchBtn);
    });

    // Second fetch call is the PATCH
    const [, patchInit] = fetchMock.mock.calls[1]!;
    const patchBody = JSON.parse((patchInit as RequestInit).body as string);

    expect("cslJson" in patchBody).toBe(true);
    expect("title" in patchBody).toBe(false);
    expect("venue" in patchBody).toBe(false);
    expect(patchBody.cslJson.title).toBe("Batch Paper");
    expect(patchBody.cslJson["container-title"]).toBe("NeurIPS");
  });
});