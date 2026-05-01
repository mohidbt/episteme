import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// G-R3-05 #73 — animation speed reverted to baseline (no slowdown multiplier).
// G-R3-05 #84 — RAF dt clamp helper exists and caps at 50ms.
const SRC = readFileSync(resolve(__dirname, "matrix.tsx"), "utf8");

describe("matrix animation speed (#73 revert)", () => {
  it("no longer declares the 75% slowdown multiplier", () => {
    expect(SRC).not.toMatch(
      /MATRIX_FRAME_INTERVAL_MULTIPLIER\s*=\s*1\s*\/\s*0\.75/,
    );
  });

  it("computes frameInterval from fps without a slowdown factor", () => {
    // Allow optional speed multiplier (#88 hover) but not the literal 1/0.75.
    expect(SRC).toMatch(/frameInterval\s*=\s*1000\s*\/\s*[(A-Za-z_]/);
    expect(SRC).not.toMatch(/0\.75/);
  });
});

describe("matrix RAF dt clamp (#84)", () => {
  it("exports a clampDt helper", async () => {
    const mod = await import("./matrix");
    expect(typeof mod.clampDt).toBe("function");
  });

  it("clamps elapsed deltas to MAX_DT_MS (50ms)", async () => {
    const { clampDt } = await import("./matrix");
    expect(clampDt(10)).toBe(10);
    expect(clampDt(50)).toBe(50);
    expect(clampDt(120)).toBe(50);
    expect(clampDt(5000)).toBe(50);
  });
});
