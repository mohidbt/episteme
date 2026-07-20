import { describe, it, expect } from "vitest";

import { normalizeLinkHref } from "./normalize-link-href";

describe("normalizeLinkHref", () => {
  it("prepends https:// to a bare hostname", () => {
    expect(normalizeLinkHref("google.com")).toBe("https://google.com");
  });

  it("prepends https:// to a bare host with path/query", () => {
    expect(normalizeLinkHref("sub.example.co.uk/path?q=1")).toBe(
      "https://sub.example.co.uk/path?q=1",
    );
  });

  it("trims surrounding whitespace before normalizing", () => {
    expect(normalizeLinkHref("  google.com  ")).toBe("https://google.com");
  });

  it("leaves an https URL unchanged", () => {
    expect(normalizeLinkHref("https://example.com")).toBe("https://example.com");
  });

  it("leaves an http URL unchanged", () => {
    expect(normalizeLinkHref("http://example.com")).toBe("http://example.com");
  });

  it("treats host:port as a bare host, not a scheme, and prepends https://", () => {
    expect(normalizeLinkHref("example.com:8080")).toBe("https://example.com:8080");
    expect(normalizeLinkHref("localhost:3000")).toBe("https://localhost:3000");
    expect(normalizeLinkHref("example.com:8080/path")).toBe("https://example.com:8080/path");
  });

  it("leaves a mailto: URL unchanged", () => {
    expect(normalizeLinkHref("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("leaves a tel: URL unchanged", () => {
    expect(normalizeLinkHref("tel:+15551234")).toBe("tel:+15551234");
  });

  it("leaves a scheme with a numeric body unchanged (not mistaken for host:port)", () => {
    expect(normalizeLinkHref("tel:112")).toBe("tel:112");
  });

  it("leaves a root-relative internal path unchanged", () => {
    expect(normalizeLinkHref("/n/foo")).toBe("/n/foo");
  });

  it("leaves a fragment anchor unchanged", () => {
    expect(normalizeLinkHref("#section")).toBe("#section");
  });

  it("leaves a protocol-relative URL unchanged", () => {
    expect(normalizeLinkHref("//cdn.example.com/x")).toBe("//cdn.example.com/x");
  });

  it("returns empty string unchanged", () => {
    expect(normalizeLinkHref("")).toBe("");
    expect(normalizeLinkHref("   ")).toBe("");
  });

  it("neutralizes a javascript: scheme to an inert #", () => {
    expect(normalizeLinkHref("javascript:alert(1)")).toBe("#");
    expect(normalizeLinkHref("  JavaScript:alert(1)  ")).toBe("#");
  });

  it("neutralizes data: and vbscript: schemes to an inert #", () => {
    expect(normalizeLinkHref("data:text/html,<script>alert(1)</script>")).toBe("#");
    expect(normalizeLinkHref("vbscript:msgbox(1)")).toBe("#");
  });
});
