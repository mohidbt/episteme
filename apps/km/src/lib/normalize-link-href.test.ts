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

  it("leaves a mailto: URL unchanged", () => {
    expect(normalizeLinkHref("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("leaves a tel: URL unchanged", () => {
    expect(normalizeLinkHref("tel:+15551234")).toBe("tel:+15551234");
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
});
