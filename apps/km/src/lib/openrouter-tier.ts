// GSD-31 — Map an OpenRouter completion price (per-token, USD) to a coarse
// $ / $$ / $$$ tier for the ModelPicker badge. Output-side pricing is the
// dominant cost driver for agent workloads, so the badge keys off
// `pricing.completion` (string) rather than input price.
//
// Thresholds, calibrated against the 2026-mid OpenRouter catalog so common
// "cheap" models (gpt-5.4-nano, Gemini Flash, GPT-OSS) land in $, mainstream
// frontier models (Claude Sonnet, GPT-5.4) land in $$, and the premium
// frontier tier (Claude Opus, o3) lands in $$$:
//
//   $   (low)  < $2/M  out tokens
//   $$  (mid)  $2/M   – <$15/M
//   $$$ (high) >= $15/M

export type PriceTier = "low" | "mid" | "high";

const LOW_THRESHOLD = 0.000002; // $2 / 1M tokens
const MID_THRESHOLD = 0.000015; // $15 / 1M tokens

export function priceTier(
  completionPricePerToken: number | null | undefined,
): PriceTier | null {
  if (
    completionPricePerToken === null ||
    completionPricePerToken === undefined ||
    !Number.isFinite(completionPricePerToken)
  ) {
    return null;
  }
  if (completionPricePerToken < LOW_THRESHOLD) return "low";
  if (completionPricePerToken < MID_THRESHOLD) return "mid";
  return "high";
}

export function tierLabel(tier: PriceTier): string {
  return tier === "low" ? "$" : tier === "mid" ? "$$" : "$$$";
}
