import { describe, it, expect } from "vitest";
import { crossRefToCsl } from "../crossref";

describe("crossRefToCsl", () => {
  it("strips JATS XML tags from abstract while preserving prose", () => {
    const message = {
      DOI: "10.1234/example",
      type: "journal-article",
      title: ["Cooperative Interactions"],
      abstract:
        "<jats:title>Abstract</jats:title><jats:p>Cooperative interactions between cells drive emergent behaviour in <jats:italic>tissues</jats:italic>.</jats:p>",
    };

    const csl = crossRefToCsl(message);

    expect(csl.abstract).toBeDefined();
    expect(csl.abstract).not.toMatch(/<jats:/i);
    expect(csl.abstract).not.toMatch(/<\/jats:/i);
    expect(csl.abstract).toContain("Cooperative interactions between cells");
    expect(csl.abstract).toContain("tissues");
  });

  it("collapses whitespace runs left over from stripped tags", () => {
    const message = {
      DOI: "10.1234/ws",
      abstract:
        "<jats:p>First sentence.</jats:p>\n\n   <jats:p>Second sentence.</jats:p>",
    };
    const csl = crossRefToCsl(message);
    expect(csl.abstract).toBe("First sentence. Second sentence.");
  });

  it("leaves plain-text abstract unchanged", () => {
    const message = {
      DOI: "10.1234/plain",
      abstract: "Plain abstract.",
    };
    const csl = crossRefToCsl(message);
    expect(csl.abstract).toBe("Plain abstract.");
  });
});
