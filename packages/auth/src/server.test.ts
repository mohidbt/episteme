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
});
