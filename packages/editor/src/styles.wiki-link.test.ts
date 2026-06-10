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

/**
 * GSD-62 — chip must look small, soft, inline. Icon must vertically center
 * with the text label, and long titles must truncate cleanly.
 */
describe("GSD-62 .wiki-link chip restyle", () => {
  const css = readFileSync(join(here, "styles.css"), "utf-8");
  const baseRule = css.match(/\.episteme-prose\s+\.wiki-link\s*\{[\s\S]*?\}/)?.[0] ?? "";

  it("uses inline-flex for icon+text vertical centering", () => {
    expect(baseRule).toMatch(/display:\s*inline-flex/);
    expect(baseRule).toMatch(/align-items:\s*center/);
  });

  it("rounds to a pill (large border-radius)", () => {
    // 9999px or rounded-full equivalent; reject the old harsh 3px corners.
    expect(baseRule).toMatch(/border-radius:\s*(9999px|999px|var\(--radius-full\))/);
    expect(baseRule).not.toMatch(/border-radius:\s*3px/);
  });

  it("truncates long titles with ellipsis", () => {
    expect(baseRule).toMatch(/max-width:/);
    expect(baseRule).toMatch(/text-overflow:\s*ellipsis/);
    expect(baseRule).toMatch(/white-space:\s*nowrap/);
    expect(baseRule).toMatch(/overflow:\s*hidden/);
  });

  it("sets a small font size for inline density", () => {
    // 0.875em (text-sm) or smaller; reject the old 0.95em which felt big.
    expect(baseRule).toMatch(/font-size:\s*0\.8(7|75)em/);
  });
});
