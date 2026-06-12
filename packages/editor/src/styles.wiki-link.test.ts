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
  // Accept either a single selector or a comma-separated selector list
  // ending with `{` (GSD-105 fix-round widened scope to include
  // `.episteme-chat-composer` as a sibling selector).
  const baseRule =
    css.match(/\.episteme-prose\s+\.wiki-link\s*(?:,[^{]*)?\{[\s\S]*?\}/)?.[0] ?? "";

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

/**
 * GSD-67/89 — unresolved + resolved chips share the single-line contract.
 * After GSD-89 the truncation contract moved to a dedicated `.wiki-link__label`
 * child span (text node alone in an inline-flex parent never triggers
 * ellipsis reliably across browsers — the raw text becomes an anonymous flex
 * item that overflows mid-glyph). The data-type selector still owns
 * `white-space: nowrap` + `overflow: hidden` on the parent, and the label
 * span owns `text-overflow: ellipsis` on the inline-block that contains the
 * text.
 */
describe("GSD-67/89 .wiki-link single-line contract", () => {
  const css = readFileSync(join(here, "styles.css"), "utf-8");
  const dataTypeRule =
    css.match(
      /\.episteme-prose\s+\.wiki-link\[data-type="wiki-link"\]\s*(?:,[^{]*)?\{[\s\S]*?\}/,
    )?.[0] ?? "";

  it("declares white-space: nowrap on the data-type rule", () => {
    expect(dataTypeRule).toMatch(/white-space:\s*nowrap/);
  });

  it("declares overflow: hidden on the data-type rule", () => {
    expect(dataTypeRule).toMatch(/overflow:\s*hidden/);
  });
});

/**
 * GSD-105 fix-round (Fix 1) — the agent chat composer host carries the
 * class `episteme-chat-composer` (not `episteme-prose`), so the wiki-link
 * pill CSS must apply under BOTH ancestor classes. Without this, chips
 * inserted in the composer render unstyled (SVG icon ballooning to ~1060px
 * because the size: 0.875em rule never applies).
 *
 * Edge cases (§12):
 *   - base rule covers `.wiki-link` background + radius
 *   - data-type rule covers `[data-type="wiki-link"]` single-line contract
 *   - svg sizing rule covers icon shrink + width:0.875em
 *   - label rule covers ellipsis truncation
 *
 * Strategy: each .episteme-prose .wiki-link* rule must have a sibling
 * selector under `.episteme-chat-composer .wiki-link*`. We don't enforce a
 * specific syntax (comma list vs duplicate rule) — only that the selector
 * appears somewhere in the file.
 */
describe("GSD-105 fix-round — wiki-link CSS scoped to .episteme-chat-composer host", () => {
  const css = readFileSync(join(here, "styles.css"), "utf-8");

  it("declares .episteme-chat-composer .wiki-link (base pill)", () => {
    expect(css).toMatch(/\.episteme-chat-composer\s+\.wiki-link\b/);
  });

  it("declares the [data-type=\"wiki-link\"] single-line contract under the composer host", () => {
    expect(css).toMatch(
      /\.episteme-chat-composer\s+\.wiki-link\[data-type="wiki-link"\]/,
    );
  });

  it("declares the svg sizing rule under the composer host", () => {
    expect(css).toMatch(/\.episteme-chat-composer\s+\.wiki-link\s+svg/);
  });

  it("declares the .wiki-link__label rule under the composer host", () => {
    expect(css).toMatch(/\.episteme-chat-composer\s+\.wiki-link__label/);
  });
});

/**
 * GSD-89 — Bug 1: ellipsis must live on a dedicated `.wiki-link__label`
 * child span. `inline-flex` parent + a raw text-node sibling next to the
 * SVG icon causes text-overflow:ellipsis on the parent to NOT take effect:
 * the text becomes an anonymous flex item that overflows mid-glyph. Fix:
 * wrap the label in `<span class="wiki-link__label">` with the standard
 * inline-block + overflow + ellipsis contract.
 */
describe("GSD-89 .wiki-link__label truncation contract", () => {
  const css = readFileSync(join(here, "styles.css"), "utf-8");
  const labelRule =
    css.match(/\.episteme-prose\s+\.wiki-link__label\s*(?:,[^{]*)?\{[\s\S]*?\}/)?.[0] ?? "";

  it("uses inline-block so text-overflow can clip", () => {
    expect(labelRule).toMatch(/display:\s*inline-block/);
  });

  it("declares overflow: hidden on the label span", () => {
    expect(labelRule).toMatch(/overflow:\s*hidden/);
  });

  it("declares text-overflow: ellipsis on the label span", () => {
    expect(labelRule).toMatch(/text-overflow:\s*ellipsis/);
  });

  it("declares white-space: nowrap on the label span", () => {
    expect(labelRule).toMatch(/white-space:\s*nowrap/);
  });

  it("declares min-width: 0 so the flex item can shrink below content width", () => {
    expect(labelRule).toMatch(/min-width:\s*0/);
  });
});
