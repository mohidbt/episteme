import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GSD-73: surface papers.abstractShort + papers.venue on the paper detail page.
// Source-level assertions mirror page.native-pdf-embed.test.ts to keep this
// test fast (no React render of an async server component).
describe("/p/[paperId] abstract + venue", () => {
  it("renders abstractShort when present and hides when null", async () => {
    const source = await readFile(path.join(__dirname, "page.tsx"), "utf8");

    // Truthiness-guarded render: `{paper.abstractShort && (` ... `)}` keeps null
    // out of the DOM (no skeleton, no placeholder).
    expect(source).toMatch(/paper\.abstractShort\s*&&/);
    // Block-level container with shared muted typography token.
    expect(source).toMatch(/data-testid="paper-abstract"/);
  });

  it("renders venue alongside year when present and hides when null", async () => {
    const source = await readFile(path.join(__dirname, "page.tsx"), "utf8");

    // Truthiness-guarded render for venue.
    expect(source).toMatch(/paper\.venue\s*&&/);
    // Shared metadata sub-row testid so siblings (year, venue) share padding.
    expect(source).toMatch(/data-testid="paper-meta-row"/);
  });
});
