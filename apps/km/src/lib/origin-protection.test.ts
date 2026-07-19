import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedOrigin } from "./origin-protection";
import { SIGN_UP_HREF, OPEN_APP_HREF } from "@/app/(public)/landing/_components/cta";

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

  // NON-REGRESSION GUARD (GSD-148): the shared-helper unification must not drop
  // any origin the CSRF guard currently accepts. A dropped entry = login 403.
  it("keeps every currently-allowed production + dev origin (superset-or-equal)", () => {
    const MUST_ALLOW = [
      "https://tryepisteme.com",
      "https://www.tryepisteme.com",
      "https://app.tryepisteme.com",
      "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
    ];
    for (const o of MUST_ALLOW) expect(isAllowedOrigin(o, null)).toBe(true);
  });

  it("derives app/www/bare for a custom EPISTEME_PUBLISH_DOMAIN", () => {
    vi.stubEnv("EPISTEME_PUBLISH_DOMAIN", "example.org");
    expect(isAllowedOrigin("https://app.example.org", null)).toBe(true);
    expect(isAllowedOrigin("https://www.example.org", null)).toBe(true);
    expect(isAllowedOrigin("https://example.org", null)).toBe(true);
  });

  it("a custom EPISTEME_PUBLISH_DOMAIN still trusts the canonical hosts (additive, GSD-148 codex MAJOR)", () => {
    vi.stubEnv("EPISTEME_PUBLISH_DOMAIN", "example.org");
    expect(isAllowedOrigin("https://app.tryepisteme.com", null)).toBe(true);
    expect(isAllowedOrigin("https://www.tryepisteme.com", null)).toBe(true);
    expect(isAllowedOrigin("https://tryepisteme.com", null)).toBe(true);
  });

  it("allows every landing-CTA host the UI links users to (fails CI on CTA drift)", () => {
    // Driven off the same constants the landing page renders — a divergent CTA
    // host would fail here instead of shipping a login 403.
    for (const href of [SIGN_UP_HREF, OPEN_APP_HREF]) {
      expect(isAllowedOrigin(new URL(href).origin, null)).toBe(true);
    }
  });
});
