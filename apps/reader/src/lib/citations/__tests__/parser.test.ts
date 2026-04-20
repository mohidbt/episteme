import { describe, it, expect } from "vitest";
import { extractCitations } from "../parser";
import type { ExtractedPage } from "@/lib/ai/pdf-text";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pages(entries: { pageNumber: number; text: string }[]): ExtractedPage[] {
  return entries;
}

// ---------------------------------------------------------------------------
// Marker extraction
// ---------------------------------------------------------------------------

describe("extractCitations — marker extraction", () => {
  it("extracts [n] markers from body text", () => {
    const result = extractCitations(
      pages([{ pageNumber: 1, text: "Foo [1] bar [2] baz [3]." }])
    );
    expect(result.markers.map((m) => m.markerIndex)).toEqual([1, 2, 3]);
  });

  it("records the first page each marker appears on", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "See [1] and [2]." },
        { pageNumber: 2, text: "Also [1] again, plus [3]." },
      ])
    );
    const byIndex = Object.fromEntries(result.markers.map((m) => [m.markerIndex, m.pageNumber]));
    expect(byIndex[1]).toBe(1);
    expect(byIndex[2]).toBe(1);
    expect(byIndex[3]).toBe(2);
  });

  it("deduplicates markers that appear on multiple pages", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "[1] [1] [1]" },
        { pageNumber: 2, text: "[1]" },
      ])
    );
    expect(result.markers.filter((m) => m.markerIndex === 1)).toHaveLength(1);
  });

  it("stores the markerText with brackets", () => {
    const result = extractCitations(
      pages([{ pageNumber: 3, text: "Citation [7] is important." }])
    );
    expect(result.markers[0].markerText).toBe("[7]");
  });

  it("ignores numbers outside bracket range 1–999", () => {
    const result = extractCitations(
      pages([{ pageNumber: 1, text: "[0] [1000] [500] valid [1]" }])
    );
    const indices = result.markers.map((m) => m.markerIndex);
    expect(indices).toContain(500);
    expect(indices).toContain(1);
    expect(indices).not.toContain(0);
    expect(indices).not.toContain(1000);
  });

  it("returns empty markers for text with no [n] patterns", () => {
    const result = extractCitations(
      pages([{ pageNumber: 1, text: "No citations here at all." }])
    );
    expect(result.markers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bibliography detection
// ---------------------------------------------------------------------------

describe("extractCitations — bibliography detection", () => {
  it("detects 'References' section header and extracts entries", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "Main text [1][2]." },
        {
          pageNumber: 2,
          text: [
            "References",
            "[1] Smith, J. (2020). A great paper. Journal of Things, 1(1), 1–10.",
            "[2] Jones, A. (2019). Another paper. Some Conference.",
          ].join("\n"),
        },
      ])
    );
    expect(result.references).toHaveLength(2);
    expect(result.references[0].markerIndex).toBe(1);
    expect(result.references[1].markerIndex).toBe(2);
  });

  it("detects 'Bibliography' header", () => {
    const result = extractCitations(
      pages([
        {
          pageNumber: 3,
          text: "Bibliography\n[1] Author X. Title. 2021.",
        },
      ])
    );
    expect(result.references).toHaveLength(1);
  });

  it("detects 'Works Cited' header", () => {
    const result = extractCitations(
      pages([
        {
          pageNumber: 3,
          text: "Works Cited\n[1] Author X. Title. 2021.",
        },
      ])
    );
    expect(result.references).toHaveLength(1);
  });

  it("detects 'Literature Cited' header", () => {
    const result = extractCitations(
      pages([
        {
          pageNumber: 3,
          text: "LITERATURE CITED\n[1] Author X. Title. 2021.",
        },
      ])
    );
    expect(result.references).toHaveLength(1);
  });

  it("is case-insensitive for section headers", () => {
    const result = extractCitations(
      pages([
        {
          pageNumber: 2,
          text: "REFERENCES\n[1] Doe, J. A study. 2018.",
        },
      ])
    );
    expect(result.references).toHaveLength(1);
  });

  it("returns empty references when no bibliography section exists", () => {
    const result = extractCitations(
      pages([{ pageNumber: 1, text: "Just body text [1] here." }])
    );
    expect(result.references).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Reference parsing — year, DOI, URL
// ---------------------------------------------------------------------------

describe("extractCitations — reference parsing", () => {
  it("extracts a 4-digit year from a reference line", () => {
    const result = extractCitations(
      pages([
        {
          pageNumber: 1,
          text: "References\n[1] Smith J. (2021). A paper on things.",
        },
      ])
    );
    expect(result.references[0].year).toBe("2021");
  });

  it("extracts a DOI from a reference line", () => {
    const result = extractCitations(
      pages([
        {
          pageNumber: 1,
          text: "References\n[1] Smith J. A paper. doi:10.1038/s41586-020-1234-5",
        },
      ])
    );
    expect(result.references[0].doi).toMatch(/^10\.\d{4,}\/.+/);
  });

  it("extracts a DOI with https://doi.org prefix", () => {
    const result = extractCitations(
      pages([
        {
          pageNumber: 1,
          text: "References\n[1] Smith J. A paper. https://doi.org/10.1000/xyz123",
        },
      ])
    );
    expect(result.references[0].doi).toMatch(/^10\.\d{4,}\/.+/);
  });

  it("extracts a URL from a reference line", () => {
    const result = extractCitations(
      pages([
        {
          pageNumber: 1,
          text: "References\n[1] Anonymous. Available at: https://example.com/paper",
        },
      ])
    );
    expect(result.references[0].url).toContain("https://example.com");
  });

  it("rawText contains the full reference line", () => {
    const refLine = "[1] Smith, J. (2020). Full reference text here. Journal, 1(1).";
    const result = extractCitations(
      pages([
        {
          pageNumber: 1,
          text: `References\n${refLine}`,
        },
      ])
    );
    expect(result.references[0].rawText).toContain("Full reference text here");
  });

  it("does not crash on completely empty pages", () => {
    const result = extractCitations(pages([{ pageNumber: 1, text: "" }]));
    expect(result.markers).toHaveLength(0);
    expect(result.references).toHaveLength(0);
  });

  it("handles multi-line reference entries (wrapped text)", () => {
    const result = extractCitations(
      pages([
        {
          pageNumber: 1,
          text: [
            "References",
            "[1] Smith, J. and Doe, A. (2020). A very long title that wraps",
            "     onto the next line of the PDF. Journal of Long Titles.",
            "[2] Jones, B. (2019). Short title. Conference.",
          ].join("\n"),
        },
      ])
    );
    expect(result.references).toHaveLength(2);
    // The wrapped continuation should be part of [1]'s rawText
    expect(result.references[0].rawText).toContain("onto the next line");
  });

  it("does not extract years outside 1900–2099", () => {
    const result = extractCitations(
      pages([
        {
          pageNumber: 1,
          text: "References\n[1] Old A. A classic work. 1850. Something else 2020.",
        },
      ])
    );
    // Should pick up 2020, not 1850
    expect(result.references[0].year).toBe("2020");
  });
});

// ---------------------------------------------------------------------------
// REF_ENTRY_START_RE — [n] style (regression)
// ---------------------------------------------------------------------------

describe("extractCitations — [n] bracket-style bibliography (regression)", () => {
  it("parses a single [1] entry", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "Some text with [1] marker." },
        {
          pageNumber: 2,
          text: "References\n[1] Smith, J. A great paper. Nature 123, 45–67 (2020).",
        },
      ])
    );
    expect(result.references).toHaveLength(1);
    expect(result.references[0].markerIndex).toBe(1);
  });

  it("parses multiple [n] entries", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "Body with [1] and [2] and [3]." },
        {
          pageNumber: 2,
          text: "References\n[1] First, A. Title one. J. Foo 1, 2 (2001).\n[2] Second, B. Title two. J. Bar 3, 4 (2002).\n[3] Third, C. Title three. J. Baz 5, 6 (2003).",
        },
      ])
    );
    expect(result.references).toHaveLength(3);
    expect(result.references.map((r) => r.markerIndex)).toEqual([1, 2, 3]);
  });

  it("parses three-digit [100] entry", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "See [100]." },
        {
          pageNumber: 2,
          text: "References\n[100] Big, C. et al. Big paper. Science 999, 1 (2010).",
        },
      ])
    );
    expect(result.references).toHaveLength(1);
    expect(result.references[0].markerIndex).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// REF_ENTRY_START_RE — n. style (Vancouver / Nature)
// ---------------------------------------------------------------------------

describe("extractCitations — Vancouver/Nature n. style bibliography", () => {
  it("parses a single '1.' entry", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "As shown in [1], this holds." },
        {
          pageNumber: 2,
          text: "References\n1. Smith, J. et al. Title of paper. Nature 123, 45–67 (2020).",
        },
      ])
    );
    expect(result.references).toHaveLength(1);
    expect(result.references[0].markerIndex).toBe(1);
  });

  it("parses multiple n. entries with the same markerIndex as [n] would", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "Body [1] [2]." },
        {
          pageNumber: 2,
          text: "References\n1. Smith, J. et al. Title of paper. Nature 123, 45–67 (2020).\n2. Other, A.B. & Foo, B. Title. Science 456, 78–90 (2019).",
        },
      ])
    );
    expect(result.references).toHaveLength(2);
    expect(result.references[0].markerIndex).toBe(1);
    expect(result.references[1].markerIndex).toBe(2);
  });

  it("parses a two-digit '10.' entry (not confused with DOI prefix)", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "See [10]." },
        {
          pageNumber: 2,
          text: "References\n10. Jones, X. Multi-digit entry. Cell 10, 10–20 (2015).",
        },
      ])
    );
    expect(result.references).toHaveLength(1);
    expect(result.references[0].markerIndex).toBe(10);
  });

  it("parses a three-digit '123.' entry", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "Marker [123]." },
        {
          pageNumber: 2,
          text: "References\n123. Big, C. et al. Long numbered entry. Science 999, 1 (2010).",
        },
      ])
    );
    expect(result.references).toHaveLength(1);
    expect(result.references[0].markerIndex).toBe(123);
  });

  it("rawText includes the full entry text", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "[1]" },
        {
          pageNumber: 2,
          text: "References\n1. Smith, J. et al. Title of paper. Nature 123, 45–67 (2020).",
        },
      ])
    );
    expect(result.references[0].rawText).toContain("Smith, J. et al.");
  });

  it("year extraction works for n. style entry", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "[1]" },
        {
          pageNumber: 2,
          text: "References\n1. Smith, J. et al. Title of paper. Nature 123, 45–67 (2020).",
        },
      ])
    );
    expect(result.references[0].year).toBe("2020");
  });

  it("DOI extraction works for n. style entry", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "[1]" },
        {
          pageNumber: 2,
          text: "References\n1. Smith, J. et al. Title. Nature 123, 45 (2020). https://doi.org/10.1038/nature12345",
        },
      ])
    );
    expect(result.references[0].doi).toBe("10.1038/nature12345");
  });
});

// ---------------------------------------------------------------------------
// DOI disambiguation edge cases
// ---------------------------------------------------------------------------

describe("extractCitations — DOI disambiguation edge cases", () => {
  it("does NOT treat '10.1038/nature...' line as a reference-entry start", () => {
    // A bare DOI line starting with 10.xxxx/... must NOT be parsed as entry 10
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "See [1]." },
        {
          pageNumber: 2,
          text: "References\n1. Smith, J. et al. Title. Nature 123, 45 (2020). https://doi.org/10.1038/nature12345\n10.1038/nature99999 should not be a new entry",
        },
      ])
    );
    // Only entry 1 should be found; the bare DOI line must not create entry 10
    expect(result.references).toHaveLength(1);
    expect(result.references[0].markerIndex).toBe(1);
  });

  it("does NOT treat '10.1000/xyz' stray DOI line as a new entry", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "See [1] and [2]." },
        {
          pageNumber: 2,
          text: "References\n1. Smith, J. et al. First entry. Nature 1, 1 (2020).\n10.1000/xyz123 continuation or stray DOI line\n2. Other, A. Second entry. Science 2, 2 (2019).",
        },
      ])
    );
    // The stray DOI line should be absorbed into entry 1 as a continuation
    expect(result.references).toHaveLength(2);
    expect(result.references[0].markerIndex).toBe(1);
    expect(result.references[1].markerIndex).toBe(2);
    expect(result.references[0].rawText).toContain("10.1000/xyz123");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("extractCitations — edge cases", () => {
  it("handles empty pages array", () => {
    const result = extractCitations([]);
    expect(result.markers).toHaveLength(0);
    expect(result.references).toHaveLength(0);
  });

  it("handles markers with no corresponding bibliography entry gracefully", () => {
    const result = extractCitations(
      pages([{ pageNumber: 1, text: "See [1] and [2] and [3]." }])
    );
    // markers found, references empty (no bib section)
    expect(result.markers).toHaveLength(3);
    expect(result.references).toHaveLength(0);
  });

  it("handles a bibliography section that spans multiple pages", () => {
    const result = extractCitations(
      pages([
        { pageNumber: 1, text: "Body [1] [2] [3]." },
        {
          pageNumber: 2,
          text: "References\n[1] First ref. (2020). Journal A.\n[2] Second ref. (2019). Journal B.",
        },
        {
          pageNumber: 3,
          text: "[3] Third ref. (2018). Journal C.",
        },
      ])
    );
    expect(result.references).toHaveLength(3);
  });
});
