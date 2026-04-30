// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Task #24 — wiki-link pills must be visibly clickable and responsive:
 * cursor pointer, slight scale + bg highlight on hover, press-down on active.
 */
describe("episteme-prose .wiki-link interactivity", () => {
  const css = readFileSync(join(here, "styles.css"), "utf-8");

  it("declares cursor: pointer on the base .wiki-link rule", () => {
    expect(css).toMatch(/\.wiki-link\s*\{[\s\S]*?cursor:\s*pointer/);
  });

  it("scales up on hover (transform: scale > 1)", () => {
    expect(css).toMatch(/\.wiki-link:hover\s*\{[\s\S]*?transform:\s*scale\(1\.0[1-9]/);
  });

  it("scales down on active (transform: scale < 1)", () => {
    expect(css).toMatch(/\.wiki-link:active\s*\{[\s\S]*?transform:\s*scale\(0\.9/);
  });

  it("changes background on hover", () => {
    expect(css).toMatch(/\.wiki-link:hover\s*\{[\s\S]*?background:\s*var\(--accent\)/);
  });
});
