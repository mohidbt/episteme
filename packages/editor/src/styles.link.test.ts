// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * GSD-29 — Plain markdown links inside the editor must render with
 * underline + neutral grey color (not browser-default blue). Use the
 * design-system grey token `--muted-foreground`.
 *
 * Scoping notes:
 *  - Rule must target `.episteme-prose a` so it does not leak to wiki-link
 *    pills (which are styled separately via `.wiki-link`).
 *  - Must exclude wiki-link / tag / pdf-embed-open anchors so their bespoke
 *    chrome is preserved. We assert by checking the selector includes
 *    `:not(.wiki-link)`.
 */
describe("episteme-prose a (markdown link mark)", () => {
  const css = readFileSync(join(here, "styles.css"), "utf-8");

  it("declares an .episteme-prose a rule", () => {
    expect(css).toMatch(/\.episteme-prose\s+a[^{]*\{/);
  });

  it("colors links with the design-system grey token --muted-foreground", () => {
    expect(css).toMatch(/\.episteme-prose\s+a[^{]*\{[\s\S]*?color:\s*var\(--muted-foreground\)/);
  });

  it("underlines link text", () => {
    expect(css).toMatch(/\.episteme-prose\s+a[^{]*\{[\s\S]*?text-decoration:\s*underline/);
  });

  it("excludes wiki-link pills from the base rule (scoped via :not)", () => {
    expect(css).toMatch(/\.episteme-prose\s+a:not\(\.wiki-link\)/);
  });
});
