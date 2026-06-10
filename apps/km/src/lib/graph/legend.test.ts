import { describe, expect, it } from "vitest";
import { LEGEND_ITEMS } from "./legend";

describe("graph legend", () => {
  it("does not include the legacy paper_is_ref entry", () => {
    expect(LEGEND_ITEMS.some((i) => i.kind === "paper_is_ref")).toBe(false);
  });

  it("does not include the legacy semantic_sim entry", () => {
    expect(LEGEND_ITEMS.some((i) => i.kind === "semantic_sim")).toBe(false);
  });

  it("still includes paper/note/reference node markers and wiki_link/shared_tag/citing edges", () => {
    const kinds = new Set(LEGEND_ITEMS.map((i) => i.kind));
    expect(kinds.has("paper")).toBe(true);
    expect(kinds.has("note")).toBe(true);
    expect(kinds.has("reference")).toBe(true);
    expect(kinds.has("wiki_link")).toBe(true);
    expect(kinds.has("shared_tag")).toBe(true);
    expect(kinds.has("citing")).toBe(true);
  });
});
