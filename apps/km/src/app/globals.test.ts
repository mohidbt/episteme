import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// RG1 #67 — verify ::selection styling is Chrome-default light blue, not dark blue.
const CSS_PATH = resolve(__dirname, "globals.css");

describe("globals.css ::selection", () => {
  const css = readFileSync(CSS_PATH, "utf8");

  it("defines a ::selection rule", () => {
    expect(css).toMatch(/::selection\s*\{/);
  });

  it("uses light-blue rgba(174, 213, 255, ...) background", () => {
    expect(css).toMatch(/rgba\(\s*174\s*,\s*213\s*,\s*255/);
  });

  it("includes a -moz-selection fallback", () => {
    expect(css).toMatch(/::-moz-selection\s*\{/);
  });
});
