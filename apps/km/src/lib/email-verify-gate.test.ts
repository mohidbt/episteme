import { describe, it, expect } from "vitest";
import { shouldBlockForEmailVerification } from "./email-verify-gate";

describe("shouldBlockForEmailVerification", () => {
  it("blocks a real user whose email is not verified", () => {
    expect(
      shouldBlockForEmailVerification({
        userId: "u1",
        isAnonymous: false,
        emailVerified: false,
      }),
    ).toBe(true);
  });

  it("allows a real user whose email is verified", () => {
    expect(
      shouldBlockForEmailVerification({
        userId: "u2",
        isAnonymous: false,
        emailVerified: true,
      }),
    ).toBe(false);
  });

  it("always allows an anonymous session, even if unverified", () => {
    expect(
      shouldBlockForEmailVerification({
        userId: "anon",
        isAnonymous: true,
        emailVerified: false,
      }),
    ).toBe(false);
  });

  it("does not gate a missing session (handled elsewhere)", () => {
    expect(shouldBlockForEmailVerification(null)).toBe(false);
  });
});
