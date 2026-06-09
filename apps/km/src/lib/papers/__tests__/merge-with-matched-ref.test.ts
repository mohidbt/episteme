import { describe, it, expect } from "vitest";
import { mergeWithMatchedRef } from "../merge-with-matched-ref";

const NOW = new Date();

function makePaper(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    libraryId: 1,
    userId: "u1",
    folderPath: "",
    folderId: null,
    prevFolderId: null,
    filename: "x.pdf",
    storageUrl: null,
    title: null,
    authors: null,
    year: null,
    doi: null,
    venue: null,
    abstractShort: null,
    chandraStatus: "pending" as const,
    chandraCompletedAt: null,
    sizeBytes: 0,
    addedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("mergeWithMatchedRef", () => {
  it("returns paper unchanged when no ref", () => {
    const paper = makePaper({ title: "Real Title" });
    const merged = mergeWithMatchedRef(paper, null);
    expect(merged).toEqual(paper);
  });

  it("paper wins on every populated field", () => {
    const paper = makePaper({
      title: "Paper Title",
      authors: ["Paper Author"],
      year: 2020,
      doi: "10.1/paper",
      venue: "Paper Venue",
      abstractShort: "paper abstract",
    });
    const csl = {
      title: "Ref Title",
      author: [{ literal: "Ref Author" }],
      issued: { "date-parts": [[1999]] },
      DOI: "10.2/ref",
      "container-title": "Ref Venue",
      abstract: "ref abstract",
    };
    const merged = mergeWithMatchedRef(paper, { cslJson: csl });
    expect(merged.title).toBe("Paper Title");
    expect(merged.authors).toEqual(["Paper Author"]);
    expect(merged.year).toBe(2020);
    expect(merged.doi).toBe("10.1/paper");
    expect(merged.venue).toBe("Paper Venue");
    expect(merged.abstractShort).toBe("paper abstract");
  });

  it("ref fills blanks (null / empty)", () => {
    const paper = makePaper();
    const csl = {
      title: "Ref Title",
      author: [{ family: "Smith", given: "A" }, { literal: "Doe, J." }],
      issued: { "date-parts": [[2010]] },
      DOI: "10.3/ref",
      "container-title": "Nature",
      abstract: "a".repeat(800),
    };
    const merged = mergeWithMatchedRef(paper, { cslJson: csl });
    expect(merged.title).toBe("Ref Title");
    expect(merged.authors).toEqual(["Smith", "Doe, J."]);
    expect(merged.year).toBe(2010);
    expect(merged.doi).toBe("10.3/ref");
    expect(merged.venue).toBe("Nature");
    expect(merged.abstractShort).toHaveLength(500);
  });

  it("empty array authors counts as blank", () => {
    const paper = makePaper({ authors: [] });
    const csl = { author: [{ literal: "X" }] };
    const merged = mergeWithMatchedRef(paper, { cslJson: csl });
    expect(merged.authors).toEqual(["X"]);
  });

  it("empty string fields count as blank", () => {
    const paper = makePaper({ title: "", venue: "" });
    const csl = { title: "Ref Title", "container-title": "Ref Venue" };
    const merged = mergeWithMatchedRef(paper, { cslJson: csl });
    expect(merged.title).toBe("Ref Title");
    expect(merged.venue).toBe("Ref Venue");
  });

  it("does not fill when ref also blank", () => {
    const paper = makePaper();
    const merged = mergeWithMatchedRef(paper, { cslJson: {} });
    expect(merged.title).toBeNull();
    expect(merged.year).toBeNull();
  });

  it("handles ref with null cslJson", () => {
    const paper = makePaper();
    const merged = mergeWithMatchedRef(paper, { cslJson: null });
    expect(merged).toEqual(paper);
  });
});
