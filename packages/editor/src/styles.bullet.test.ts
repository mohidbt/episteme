// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Regression for Task #21: bullets must render visibly inside `.episteme-prose`.
 *
 * Tailwind v4 preflight resets `ul,ol` to `list-style: none`. Without an
 * explicit override the bullet marker disappears even though indentation is
 * preserved. The editor stylesheet must restore `list-style` for prose lists.
 */
describe("episteme-prose list styles", () => {
  it("declares list-style: disc on ul and decimal on ol", () => {
    const css = readFileSync(join(here, "styles.css"), "utf-8");
    // Match the rule for `.episteme-prose ul` (allowing a sibling `ol` selector
    // and any other declarations in the block).
    expect(css).toMatch(
      /\.episteme-prose ul[\s\S]*?list-style:\s*disc/,
    );
    expect(css).toMatch(
      /\.episteme-prose ol[\s\S]*?list-style:\s*decimal/,
    );
  });
});
