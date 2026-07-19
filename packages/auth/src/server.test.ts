import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTrustedOrigins } from "./server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveTrustedOrigins", () => {
  it("trusts the app.<domain> subdomain (GSD: landing CTA links there)", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://tryepisteme.com");
    vi.stubEnv("EPISTEME_PUBLISH_DOMAIN", "tryepisteme.com");
    const origins = resolveTrustedOrigins();
    expect(origins).toContain("https://app.tryepisteme.com");
    expect(origins).toContain("https://tryepisteme.com");
    expect(origins).toContain("https://www.tryepisteme.com");
  });

  it("derives the app subdomain from EPISTEME_PUBLISH_DOMAIN", () => {
    vi.stubEnv("EPISTEME_PUBLISH_DOMAIN", "example.org");
    const origins = resolveTrustedOrigins();
    expect(origins).toContain("https://app.example.org");
    expect(origins).toContain("https://example.org");
  });

  it("falls back to tryepisteme.com when EPISTEME_PUBLISH_DOMAIN is empty string", () => {
    // .env.production ships EPISTEME_PUBLISH_DOMAIN="" — `||` must catch it.
    vi.stubEnv("EPISTEME_PUBLISH_DOMAIN", "");
    const origins = resolveTrustedOrigins();
    expect(origins).toContain("https://app.tryepisteme.com");
    expect(origins).not.toContain("https://app.");
  });

  it("always trusts localhost dev ports", () => {
    const origins = resolveTrustedOrigins();
    expect(origins).toContain("http://localhost:3000");
    expect(origins).toContain("http://localhost:3001");
  });

  // NON-REGRESSION GUARD (GSD-148): the unification refactor must not silently
  // drop any origin the production auth flow currently trusts. This frozen list
  // is the set of REAL public + dev origins that were trusted before the shared
  // helper was introduced. A dropped entry here = a login-origin 403 outage.
  it("keeps every currently-trusted production + dev origin (superset-or-equal)", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://tryepisteme.com");
    vi.stubEnv("EPISTEME_PUBLISH_DOMAIN", "tryepisteme.com");
    const origins = resolveTrustedOrigins();
    const MUST_TRUST = [
      "https://tryepisteme.com",
      "https://www.tryepisteme.com",
      "https://app.tryepisteme.com",
      "http://localhost:3000",
      "http://localhost:3001",
    ];
    for (const o of MUST_TRUST) expect(origins).toContain(o);
  });

  it("still folds in env-URL-derived origins (BETTER_AUTH_URL, VERCEL_URL) — not dropped", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://custom-auth.example.com");
    vi.stubEnv("VERCEL_URL", "km-preview-abc.vercel.app");
    const origins = resolveTrustedOrigins();
    expect(origins).toContain("https://custom-auth.example.com");
    expect(origins).toContain("https://km-preview-abc.vercel.app");
  });

  it("trusts the landing-CTA host the UI links users to", () => {
    // The landing CTA (apps/km .../landing/_components/cta.ts) links users to
    // https://app.<domain>. The CTA-source-driven CI check lives in apps/km
    // (origin-protection.test.ts) since the constant lives there; here we assert
    // the app host is trusted so a dropped app-origin fails in this package too.
    vi.stubEnv("EPISTEME_PUBLISH_DOMAIN", "tryepisteme.com");
    const origins = resolveTrustedOrigins();
    expect(origins).toContain("https://app.tryepisteme.com");
  });
});
