import { describe, it, expect } from "vitest";
import { validateCslJson, deriveCitationKey, denormaliseForList } from "./csl";

const canonicalItem = {
  id: "item-1",
  type: "article-journal",
  title: "Attention Is All You Need",
  author: [{ family: "Vaswani", given: "Ashish" }],
  issued: { "date-parts": [[2017]] },
  DOI: "10.1234/example",
};

// ── validateCslJson ──────────────────────────────────────────────────────────

describe("validateCslJson", () => {
  it("returns canonical CSL item unchanged", () => {
    const result = validateCslJson(canonicalItem);
    expect(result).toBe(canonicalItem);
  });

  it("throws when id is missing", () => {
    expect(() =>
      validateCslJson({ type: "article-journal" }),
    ).toThrow(/id/);
  });

  it("throws when type is missing", () => {
    expect(() => validateCslJson({ id: "x" })).toThrow(/type/);
  });

  it("throws when id is not a string", () => {
    expect(() =>
      validateCslJson({ id: 42, type: "article-journal" }),
    ).toThrow(/id/);
  });

  it("throws when type is not a string", () => {
    expect(() =>
      validateCslJson({ id: "x", type: 99 }),
    ).toThrow(/type/);
  });

  it("throws for non-object input (string)", () => {
    expect(() => validateCslJson("not an object")).toThrow();
  });

  it("throws for null input", () => {
    expect(() => validateCslJson(null)).toThrow();
  });
});

// ── deriveCitationKey ────────────────────────────────────────────────────────

describe("deriveCitationKey", () => {
  it("produces vaswani2017attention", () => {
    expect(
      deriveCitationKey({
        id: "x",
        type: "article-journal",
        author: [{ family: "Vaswani" }],
        issued: { "date-parts": [[2017]] },
        title: "Attention Is All You Need",
      }),
    ).toBe("vaswani2017attention");
  });

  it("skips stop-word 'The' and picks first substantial word", () => {
    expect(
      deriveCitationKey({
        id: "x",
        type: "article-journal",
        author: [{ family: "Doe" }],
        issued: { "date-parts": [[2024]] },
        title: "Graph Attention Networks",
      }),
    ).toBe("doe2024graph");
  });

  it("strips unicode diacritics and lowercases author name", () => {
    const key = deriveCitationKey({
      id: "x",
      type: "article-journal",
      author: [{ family: "Ángel" }],
      issued: { "date-parts": [[2020]] },
      title: "Some Title",
    });
    expect(key.startsWith("angel")).toBe(true);
  });

  it("falls back to 'unknown' when no authors", () => {
    const key = deriveCitationKey({
      id: "x",
      type: "misc",
      issued: { "date-parts": [[2020]] },
      title: "Something",
    });
    expect(key.startsWith("unknown")).toBe(true);
  });

  it("falls back to 'nd' when no date", () => {
    const key = deriveCitationKey({
      id: "x",
      type: "misc",
      author: [{ family: "Smith" }],
      title: "Something",
    });
    expect(key).toContain("nd");
  });

  it("falls back to 'untitled' when no title", () => {
    const key = deriveCitationKey({
      id: "x",
      type: "misc",
      author: [{ family: "Smith" }],
      issued: { "date-parts": [[2020]] },
    });
    expect(key.endsWith("untitled")).toBe(true);
  });

  it("falls back to all three defaults when nothing is provided", () => {
    expect(
      deriveCitationKey({ id: "x", type: "misc" }),
    ).toBe("unknownnduntitled");
  });

  it("uses literal name when family is absent", () => {
    const key = deriveCitationKey({
      id: "x",
      type: "misc",
      author: [{ literal: "Anonymous Org" }],
      issued: { "date-parts": [[2021]] },
      title: "Report",
    });
    expect(key.startsWith("anonymous")).toBe(true);
  });
});

// ── denormaliseForList ───────────────────────────────────────────────────────

describe("denormaliseForList", () => {
  it("returns title from csl.title", () => {
    const r = denormaliseForList({ ...canonicalItem });
    expect(r.title).toBe("Attention Is All You Need");
  });

  it("returns empty string when title absent", () => {
    const r = denormaliseForList({ id: "x", type: "misc" });
    expect(r.title).toBe("");
  });

  it("returns solo author family name", () => {
    const r = denormaliseForList({
      id: "x",
      type: "misc",
      author: [{ family: "Solo" }],
    });
    expect(r.authorsText).toBe("Solo");
  });

  it("returns 'A & B' for two authors", () => {
    const r = denormaliseForList({
      id: "x",
      type: "misc",
      author: [{ family: "Alpha" }, { family: "Beta" }],
    });
    expect(r.authorsText).toBe("Alpha & Beta");
  });

  it("returns 'A et al.' for three or more authors", () => {
    const r = denormaliseForList({
      id: "x",
      type: "misc",
      author: [{ family: "A" }, { family: "B" }, { family: "C" }],
    });
    expect(r.authorsText).toBe("A et al.");
  });

  it("returns '' when no authors", () => {
    const r = denormaliseForList({ id: "x", type: "misc" });
    expect(r.authorsText).toBe("");
  });

  it("returns year as number from issued date-parts", () => {
    const r = denormaliseForList(canonicalItem);
    expect(r.year).toBe(2017);
  });

  it("returns null year when issued is absent", () => {
    const r = denormaliseForList({ id: "x", type: "misc" });
    expect(r.year).toBeNull();
  });

  it("returns doi from uppercase DOI field", () => {
    const r = denormaliseForList(canonicalItem);
    expect(r.doi).toBe("10.1234/example");
  });

  it("returns null doi when DOI absent", () => {
    const r = denormaliseForList({ id: "x", type: "misc" });
    expect(r.doi).toBeNull();
  });
});
