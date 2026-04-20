import { describe, it, expect } from "vitest";
import { buildExplainSeed } from "../explain-seed";

describe("buildExplainSeed", () => {
  it("section_header with text", () => {
    const result = buildExplainSeed({
      kind: "section_header",
      payload: { text: "Introduction", heading_level: 1 },
    });
    expect(result).toBe('Explain this section.\n\n"Introduction"');
  });

  it("section_header without text", () => {
    const result = buildExplainSeed({ kind: "section_header", payload: {} });
    expect(result).toBe("Explain this section.");
  });

  it("figure with caption", () => {
    const result = buildExplainSeed({
      kind: "figure",
      payload: { caption: "Flow diagram of the model" },
    });
    expect(result).toBe("Explain this figure.\n\nCaption: Flow diagram of the model");
  });

  it("figure without caption", () => {
    const result = buildExplainSeed({ kind: "figure", payload: {} });
    expect(result).toBe("Explain this figure.");
  });

  it("formula with latex", () => {
    const result = buildExplainSeed({
      kind: "formula",
      payload: { latex: "E = mc^2" },
    });
    expect(result).toBe("Explain this formula.\n\n$$E = mc^2$$");
  });

  it("formula without latex", () => {
    const result = buildExplainSeed({ kind: "formula", payload: {} });
    expect(result).toBe("Explain this formula.");
  });

  it("formula with HTML-wrapped latex", () => {
    const result = buildExplainSeed({
      kind: "formula",
      payload: { latex: "<math xmlns=\"http://www.w3.org/1998/Math/MathML\"><mi>E</mi></math>" },
    });
    expect(result).toBe("Explain this formula.\n\n$$E$$");
  });

  it("formula with HTML-entity encoded latex", () => {
    const result = buildExplainSeed({
      kind: "formula",
      payload: { latex: "a &lt; b" },
    });
    expect(result).toBe("Explain this formula.\n\n$$a < b$$");
  });

  it("formula with all-HTML-no-text input", () => {
    const result = buildExplainSeed({
      kind: "formula",
      payload: { latex: "<span></span>" },
    });
    expect(result).toBe("Explain this formula.");
  });
});
