// GSD-30 — `humanizeToolName` is the canonical prettifier used in the agent
// transcript and the permissions tab. Pure util, no React.
import { describe, expect, it } from "vitest";
import { humanizeToolName } from "./tool-categories";

describe("humanizeToolName (GSD-30)", () => {
  it("title-cases each underscore segment", () => {
    expect(humanizeToolName("create_note")).toBe("Create Note");
    expect(humanizeToolName("pdf_explain_passage")).toBe("Pdf Explain Passage");
  });

  it("handles a single word", () => {
    expect(humanizeToolName("search")).toBe("Search");
  });

  it("drops empty segments from repeated underscores", () => {
    expect(humanizeToolName("foo__bar")).toBe("Foo Bar");
  });

  it("returns empty string for empty input", () => {
    expect(humanizeToolName("")).toBe("");
  });
});
