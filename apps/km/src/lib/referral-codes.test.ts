import { describe, it, expect } from "vitest";
import { generateReferralCodes, REFERRAL_CODES_PER_USER } from "./referral-codes";

describe("generateReferralCodes", () => {
  it("returns 5 codes for username 'tom'", () => {
    expect(generateReferralCodes("tom")).toEqual([
      "episteme-tom-1",
      "episteme-tom-2",
      "episteme-tom-3",
      "episteme-tom-4",
      "episteme-tom-5",
    ]);
  });

  it("REFERRAL_CODES_PER_USER is 5", () => {
    expect(REFERRAL_CODES_PER_USER).toBe(5);
  });

  it("lowercases and trims the username", () => {
    expect(generateReferralCodes("  Alice  ")[0]).toBe("episteme-alice-1");
  });

  it("throws when username is empty", () => {
    expect(() => generateReferralCodes("")).toThrow();
    expect(() => generateReferralCodes("   ")).toThrow();
  });
});
