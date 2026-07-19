import { describe, expect, it } from "vitest";
import { trustedOriginsFor } from "./trusted-hosts";

describe("trustedOriginsFor", () => {
  it("emits bare + www + app for the given publish domain", () => {
    const origins = trustedOriginsFor("tryepisteme.com");
    expect(origins).toContain("https://tryepisteme.com");
    expect(origins).toContain("https://www.tryepisteme.com");
    expect(origins).toContain("https://app.tryepisteme.com");
  });

  it("derives hosts from a custom publish domain", () => {
    const origins = trustedOriginsFor("example.org");
    expect(origins).toContain("https://example.org");
    expect(origins).toContain("https://www.example.org");
    expect(origins).toContain("https://app.example.org");
  });

  it("falls back to tryepisteme.com on empty string (|| not ??)", () => {
    // .env.production ships EPISTEME_PUBLISH_DOMAIN="" — must NOT yield garbage "https://app.".
    const origins = trustedOriginsFor("");
    expect(origins).toContain("https://app.tryepisteme.com");
    expect(origins).not.toContain("https://app.");
  });

  it("falls back when publish domain is undefined", () => {
    const origins = trustedOriginsFor(undefined);
    expect(origins).toContain("https://app.tryepisteme.com");
  });

  it("includes localhost and 127.0.0.1 dev origins on both ports", () => {
    const origins = trustedOriginsFor("tryepisteme.com");
    expect(origins).toContain("http://localhost:3000");
    expect(origins).toContain("http://localhost:3001");
    expect(origins).toContain("http://127.0.0.1:3000");
    expect(origins).toContain("http://127.0.0.1:3001");
  });

  it("never emits the garbage www.app.<domain> host", () => {
    const origins = trustedOriginsFor("tryepisteme.com");
    expect(origins).not.toContain("https://www.app.tryepisteme.com");
  });
});
