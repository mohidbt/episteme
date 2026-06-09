// GSD-31 — OpenRouter model cost indicator. priceTier maps a per-token
// completion price (in USD, as exposed by OpenRouter pricing.completion)
// to a $ / $$ / $$$ bucket. The ModelPicker badges each row in
// green/yellow/red based on the bucket.
//
// Thresholds (per million OUTPUT tokens):
//   $   (low)  < $2/M       -> price_per_token < 0.000002
//   $$  (mid)  < $15/M      -> price_per_token < 0.000015
//   $$$ (high) >= $15/M
//
// Missing / non-finite pricing returns null so the badge can be skipped.
import { describe, expect, it } from "vitest";
import { priceTier, tierLabel } from "./openrouter-tier";

describe("priceTier (GSD-31)", () => {
  it("returns null for missing / non-finite pricing", () => {
    expect(priceTier(null)).toBeNull();
    expect(priceTier(undefined)).toBeNull();
    expect(priceTier(Number.NaN)).toBeNull();
  });

  it("classifies sub-$2/M as low", () => {
    // gpt-5.4-nano = $0.40/M out -> 0.0000004
    expect(priceTier(0.0000004)).toBe("low");
    // free model -> 0 falls in low bucket
    expect(priceTier(0)).toBe("low");
    // just below $2/M
    expect(priceTier(0.0000019)).toBe("low");
  });

  it("classifies $2/M to <$15/M as mid", () => {
    expect(priceTier(0.000002)).toBe("mid"); // exactly $2/M
    expect(priceTier(0.00001)).toBe("mid"); // $10/M
    expect(priceTier(0.0000149)).toBe("mid"); // just below $15/M
  });

  it("classifies >=$15/M as high", () => {
    expect(priceTier(0.000015)).toBe("high"); // exactly $15/M
    expect(priceTier(0.000075)).toBe("high"); // claude opus tier ~$75/M
  });
});

describe("tierLabel (GSD-31)", () => {
  it("maps tiers to $/$$/$$$", () => {
    expect(tierLabel("low")).toBe("$");
    expect(tierLabel("mid")).toBe("$$");
    expect(tierLabel("high")).toBe("$$$");
  });
});
