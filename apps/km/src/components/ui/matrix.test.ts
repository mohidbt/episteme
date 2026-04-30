import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// RG1 #60 — verify Matrix runs animations at 75% speed (frame interval × 1/0.75).
const SRC = readFileSync(resolve(__dirname, "matrix.tsx"), "utf8");

describe("matrix animation speed", () => {
  it("declares the 75% speed multiplier constant", () => {
    expect(SRC).toMatch(/MATRIX_FRAME_INTERVAL_MULTIPLIER\s*=\s*1\s*\/\s*0\.75/);
  });

  it("applies the multiplier to frameInterval", () => {
    expect(SRC).toMatch(
      /frameInterval\s*=\s*\(1000\s*\/\s*options\.fps\)\s*\*\s*MATRIX_FRAME_INTERVAL_MULTIPLIER/,
    );
  });
});
