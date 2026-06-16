import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { CitationsSidebar } from "../CitationsSidebar";
import type { CitationWithStatus } from "../CitationCard";

// GSD-125: reader sidebar gains a manual "Enrich citations" button mirroring
// PaperCitationsList on /p/[id]. Auto-POST on open is gone (covered in the
// hook test); this file verifies the button's enable/disable + POST + refetch
// behaviour.

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockImplementation(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeCitation(
  id: number,
  overrides: Partial<CitationWithStatus> = {},
): CitationWithStatus {
  return {
    id,
    paperId: "paper-1",
    markerText: `[${id}]`,
    markerIndex: id,
    rawText: `Ref ${id}`,
    title: `Title ${id}`,
    authors: null,
    year: "2024",
    doi: `10.x/${id}`,
    url: null,
    semanticScholarId: null,
    abstract: null,
    venue: null,
    citationCount: null,
    pageNumber: null,
    createdAt: new Date(),
    influentialCitationCount: null,
    openAccessPdfUrl: null,
    tldrText: null,
    externalIds: null,
    bibtex: null,
    enrichedAt: null,
    keptId: null,
    libraryReferenceId: null,
    ...overrides,
  };
}

describe("CitationsSidebar enrich button (GSD-125)", () => {
  it("renders the Enrich citations button when citations exist", () => {
    render(
      <CitationsSidebar
        paperId="p-1"
        open={true}
        citations={[makeCitation(1)]}
        loading={false}
      />,
    );
    expect(screen.getByTestId("reader-enrich-citations-button")).toBeDefined();
  });

  it("button is enabled when at least one DOI ref is unenriched", () => {
    render(
      <CitationsSidebar
        paperId="p-1"
        open={true}
        citations={[
          makeCitation(1, { enrichedAt: null, doi: "10.x/1" }),
          makeCitation(2, { enrichedAt: new Date(), doi: "10.x/2" }),
        ]}
        loading={false}
      />,
    );
    const btn = screen.getByTestId("reader-enrich-citations-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("button is disabled when every DOI ref is already enriched", () => {
    render(
      <CitationsSidebar
        paperId="p-1"
        open={true}
        citations={[
          makeCitation(1, { enrichedAt: new Date(), doi: "10.x/1" }),
          makeCitation(2, { enrichedAt: new Date(), doi: "10.x/2" }),
        ]}
        loading={false}
      />,
    );
    const btn = screen.getByTestId("reader-enrich-citations-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("button is disabled when no ref has a DOI", () => {
    render(
      <CitationsSidebar
        paperId="p-1"
        open={true}
        citations={[
          makeCitation(1, { doi: null, enrichedAt: null }),
          makeCitation(2, { doi: null, enrichedAt: null }),
        ]}
        loading={false}
      />,
    );
    const btn = screen.getByTestId("reader-enrich-citations-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("click POSTs /citations/enrich and calls onExtracted on success", async () => {
    const onExtracted = vi.fn();
    render(
      <CitationsSidebar
        paperId="paper-xyz"
        open={true}
        citations={[makeCitation(1, { doi: "10.x/1", enrichedAt: null })]}
        loading={false}
        onExtracted={onExtracted}
      />,
    );

    const btn = screen.getByTestId("reader-enrich-citations-button") as HTMLButtonElement;
    await act(async () => {
      btn.click();
      await Promise.resolve();
    });

    const enrichCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === "string" && url.endsWith("/citations/enrich"),
    );
    expect(enrichCalls.length).toBe(1);
    expect(enrichCalls[0][0]).toBe("/api/papers/paper-xyz/citations/enrich");
    expect(enrichCalls[0][1]).toMatchObject({ method: "POST" });
    expect(onExtracted).toHaveBeenCalledTimes(1);
  });
});
