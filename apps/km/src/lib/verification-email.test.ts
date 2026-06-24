import { describe, expect, it } from "vitest";
import { buildVerificationEmail } from "./verification-email";

describe("buildVerificationEmail", () => {
  const url = "https://tryepisteme.com/api/auth/verify-email?token=abc";

  it("includes the verify URL in both html and text bodies", () => {
    const email = buildVerificationEmail({ url, firstname: "Ada" });
    expect(email.html).toContain(url);
    expect(email.text).toContain(url);
  });

  it("has a non-empty subject mentioning verification", () => {
    const email = buildVerificationEmail({ url });
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.subject.toLowerCase()).toContain("verify");
  });

  it("greets by firstname when provided and falls back gracefully", () => {
    expect(buildVerificationEmail({ url, firstname: "Ada" }).text).toContain(
      "Ada",
    );
    // No firstname → still produces a valid body containing the url.
    expect(buildVerificationEmail({ url }).text).toContain(url);
  });
});
