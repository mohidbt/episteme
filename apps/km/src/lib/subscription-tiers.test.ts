import { describe, expect, it } from "vitest";
import {
  bucketConfigForTier,
  isSubscriptionTier,
} from "./subscription-tiers";

describe("subscription-tiers (GSD-140)", () => {
  it("maps High → bucket limit 2, weekly", () => {
    expect(bucketConfigForTier("high")).toEqual({
      limit: 2,
      limitReset: "weekly",
      label: "high",
    });
  });

  it("maps Max → bucket limit 4, weekly", () => {
    expect(bucketConfigForTier("max")).toEqual({
      limit: 4,
      limitReset: "weekly",
      label: "max",
    });
  });

  it("validates tier strings", () => {
    expect(isSubscriptionTier("high")).toBe(true);
    expect(isSubscriptionTier("max")).toBe(true);
    expect(isSubscriptionTier("trial")).toBe(false);
    expect(isSubscriptionTier("free")).toBe(false);
  });
});
