import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedOrigin } from "./origin-protection";

afterEach(() => vi.unstubAllEnvs());

describe("isAllowedOrigin", () => {
  it("allows the app.<domain> subdomain (canonical app host)", () => {
    expect(isAllowedOrigin("https://app.tryepisteme.com", "app.tryepisteme.com")).toBe(true);
    // Even when host header differs (proxied), the allowlist still matches.
    expect(isAllowedOrigin("https://app.tryepisteme.com", null)).toBe(true);
  });

  it("allows bare + www prod and localhost dev", () => {
    expect(isAllowedOrigin("https://tryepisteme.com", null)).toBe(true);
    expect(isAllowedOrigin("https://www.tryepisteme.com", null)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000", null)).toBe(true);
  });

  it("allows vercel preview deploys", () => {
    vi.stubEnv("VERCEL_URL", "km-abc123.vercel.app");
    expect(isAllowedOrigin("https://km-abc123.vercel.app", null)).toBe(true);
  });

  it("rejects attacker-controlled deployments on the shared Vercel domain", () => {
    vi.stubEnv("VERCEL_URL", "km-abc123.vercel.app");
    expect(isAllowedOrigin("https://evil.vercel.app", null)).toBe(false);
  });

  it("rejects unknown origins and missing origin", () => {
    expect(isAllowedOrigin("https://evil.example.com", null)).toBe(false);
    expect(isAllowedOrigin(null, "app.tryepisteme.com")).toBe(false);
  });
});
