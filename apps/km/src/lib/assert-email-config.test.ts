import { afterEach, describe, expect, it, vi } from "vitest";
import { assertResendConfigured } from "./assert-email-config";

describe("assertResendConfigured", () => {
  const origKey = process.env.RESEND_API_KEY;
  const origEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.RESEND_API_KEY = origKey;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("loudly console.errors in production when RESEND_API_KEY is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.RESEND_API_KEY;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    assertResendConfigured();

    expect(err).toHaveBeenCalled();
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("RESEND_API_KEY");
  });

  it("does not error in production when RESEND_API_KEY is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.RESEND_API_KEY = "re_live_key";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    assertResendConfigured();

    expect(err).not.toHaveBeenCalled();
  });

  it("stays quiet outside production even when unset (local dev is fine)", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.RESEND_API_KEY;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    assertResendConfigured();

    expect(err).not.toHaveBeenCalled();
  });
});
