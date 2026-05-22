import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PaperCitationsList import boundary", () => {
  it("does not import CitationCard through the reader barrel", () => {
    const source = readFileSync(
      resolve(__dirname, "PaperCitationsList.tsx"),
      "utf8",
    );

    expect(source).not.toContain('from "@episteme/reader"');
    expect(source).toContain('from "@episteme/reader/citation-card"');
  });
});
