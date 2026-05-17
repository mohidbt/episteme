import { describe, it, expect } from "vitest";
import { paperCitationHoverLabel } from "./edge-labels";

const link = {
  kind: "paper_citation" as const,
  src: { kind: "paper" as const, id: "A" },
  dst: { kind: "paper" as const, id: "B" },
};

describe("paperCitationHoverLabel", () => {
  it("returns 'citing' when focused node is the citer (src)", () => {
    expect(paperCitationHoverLabel(link, "paper:A")).toBe("citing");
  });

  it("returns 'cited in' when focused node is the cited paper (dst)", () => {
    expect(paperCitationHoverLabel(link, "paper:B")).toBe("cited in");
  });

  it("returns null when no node is focused", () => {
    expect(paperCitationHoverLabel(link, null)).toBeNull();
  });

  it("returns null for an unrelated focused node", () => {
    expect(paperCitationHoverLabel(link, "paper:C")).toBeNull();
  });

  it("returns null for non-paper_citation edges", () => {
    const other = { ...link, kind: "wiki_link" as const };
    expect(paperCitationHoverLabel(other, "paper:A")).toBeNull();
  });
});
