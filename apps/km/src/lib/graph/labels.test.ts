import { describe, expect, it } from "vitest";
import { formatGraphKindLabel } from "./labels";

describe("formatGraphKindLabel", () => {
  it("title-cases edge kinds", () => {
    expect(formatGraphKindLabel("paper_is_ref")).toBe("Paper Is Ref");
    expect(formatGraphKindLabel("semantic_sim")).toBe("Semantic Sim");
  });

  it("title-cases node kinds", () => {
    expect(formatGraphKindLabel("paper")).toBe("Paper");
    expect(formatGraphKindLabel("reference")).toBe("Reference");
  });
});
