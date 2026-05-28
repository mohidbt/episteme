// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Task #24 / O1 — wiki-link pills must be visibly clickable and responsive,
 * with a subtle modern hover: cursor pointer, light tinted background +
 * border on hover, small translate-y lift on hover, reset on active.
 */
describe("episteme-prose .wiki-link interactivity", () => {
  const css = readFileSync(join(here, "styles.css"), "utf-8");

  it("declares cursor: pointer on the base .wiki-link rule", () => {
    expect(css).toMatch(/\.wiki-link\s*\{[\s\S]*?cursor:\s*pointer/);
  });

  it("lifts on hover (transform: translateY negative)", () => {
    expect(css).toMatch(/\.wiki-link:hover\s*\{[\s\S]*?transform:\s*translateY\(-1px\)/);
  });

  it("resets translate on active", () => {
    expect(css).toMatch(/\.wiki-link:active\s*\{[\s\S]*?transform:\s*translateY\(0\)/);
  });

  it("tints background on hover", () => {
    expect(css).toMatch(/\.wiki-link:hover\s*\{[\s\S]*?background:\s*color-mix\(/);
  });
});
