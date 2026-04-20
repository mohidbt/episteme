import { describe, it, expect } from "vitest";
import { formatBibtex } from "../bibtex";

describe("formatBibtex", () => {
  it("full input: all fields populated → well-formed @article with correct entry key", () => {
    const result = formatBibtex({
      paperId: "abc123",
      doi: "10.5555/1234",
      title: "Attention Is All You Need",
      authors: [
        { name: "Ashish Vaswani", authorId: "auth1" },
        { name: "Noam Shazeer", authorId: "auth2" },
      ],
      year: 2017,
      venue: "NeurIPS",
    });
    expect(result).toMatch(/^@article\{/);
    // Entry key: first author lastname + year + first title word
    expect(result).toMatch(/^@article\{vaswani2017attention/i);
    expect(result).toContain("title = {Attention Is All You Need}");
    expect(result).toContain("year = {2017}");
    expect(result).toContain("journal = {NeurIPS}");
    // Both authors
    expect(result).toContain("Ashish Vaswani");
    expect(result).toContain("Noam Shazeer");
    expect(result).toContain(" and ");
  });

  it("minimal input: only title → entry key falls back; no author field", () => {
    const result = formatBibtex({
      title: "Some Paper Title",
    });
    expect(result).toMatch(/^@article\{/);
    expect(result).toContain("title = {Some Paper Title}");
    // No authors field
    expect(result).not.toContain("author = ");
  });

  it("special chars in title: {} and & are escaped", () => {
    const result = formatBibtex({
      title: "Cats & Dogs {revisited}",
      authors: [{ name: "Jane Doe" }],
      year: 2020,
    });
    // & → \&, { and } → \{ and \}
    expect(result).toContain("\\&");
    expect(result).toContain("\\{");
    expect(result).toContain("\\}");
  });

  it("multi-author: authors joined with ' and ' between entries", () => {
    const result = formatBibtex({
      title: "Multi Author Paper",
      authors: [
        { name: "Alice Smith" },
        { name: "Bob Jones" },
        { name: "Carol White" },
      ],
      year: 2021,
    });
    expect(result).toContain("Alice Smith and Bob Jones and Carol White");
  });

  it("null year: year field omitted from output", () => {
    const result = formatBibtex({
      title: "No Year Paper",
      authors: [{ name: "John Doe" }],
      year: null,
    });
    expect(result).not.toContain("year = ");
  });

  it("non-ASCII author name: entry key uses ASCII-only slug (ü → u)", () => {
    const result = formatBibtex({
      title: "Some Paper",
      authors: [{ name: "Hans Müller" }],
      year: 2024,
    });
    expect(result).toMatch(/^@article\{muller2024/i);
    // Entry key must not contain the raw non-ASCII character
    expect(result.split("\n")[0]).not.toContain("ü");
  });

  it("backslash in title: escaped as textbackslash in BibTeX output", () => {
    const result = formatBibtex({
      title: "Back\\slash",
      authors: [{ name: "Jane Doe" }],
      year: 2023,
    });
    // Implementation escapes \ → \textbackslash{} (braces are then further escaped)
    expect(result).toContain("textbackslash");
  });
});
