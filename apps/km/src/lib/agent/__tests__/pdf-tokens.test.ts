// GSD-100 - RED. Regex + replacement helper for [[pdf:UUID#pN]] tokens
// emitted by the deep-read agent skill as page-granular citation anchors.

import { describe, it, expect } from "vitest";
import {
  PDF_TOKEN_RE,
  replacePdfTokensWithLinks,
  parsePdfSentinelHref,
} from "../pdf-tokens";

describe("PDF_TOKEN_RE", () => {
  it("matches a hex uuid + #pN", () => {
    PDF_TOKEN_RE.lastIndex = 0;
    const m = PDF_TOKEN_RE.exec(
      "see [[pdf:72e1ca2f-4b4f-44b5-bcc0-fc01b3d088a2#p1]] now",
    );
    expect(m).not.toBeNull();
    expect(m?.groups?.id).toBe("72e1ca2f-4b4f-44b5-bcc0-fc01b3d088a2");
    expect(m?.groups?.page).toBe("1");
  });

  it("matches multi-digit pages", () => {
    PDF_TOKEN_RE.lastIndex = 0;
    const m = PDF_TOKEN_RE.exec("[[pdf:abc-123#p42]]");
    expect(m?.groups?.page).toBe("42");
  });

  it("does NOT match legacy filename form [[pdf:foo.pdf]]", () => {
    PDF_TOKEN_RE.lastIndex = 0;
    expect(PDF_TOKEN_RE.exec("[[pdf:foo.pdf]]")).toBeNull();
  });

  it("does NOT match [[pdf:uuid]] without #pN", () => {
    PDF_TOKEN_RE.lastIndex = 0;
    expect(PDF_TOKEN_RE.exec("[[pdf:abc-123]]")).toBeNull();
  });
});

describe("replacePdfTokensWithLinks", () => {
  it("rewrites token to a markdown link with sentinel href", () => {
    const out = replacePdfTokensWithLinks(
      "Key result [[pdf:11111111-1111-1111-1111-111111111111#p2]] here",
    );
    expect(out).toBe(
      "Key result [p 2](#__pdf:11111111-1111-1111-1111-111111111111:2) here",
    );
  });

  it("rewrites multiple tokens in order", () => {
    const out = replacePdfTokensWithLinks(
      "A [[pdf:aaa#p1]] and B [[pdf:bbb#p3]] end",
    );
    expect(out).toBe("A [p 1](#__pdf:aaa:1) and B [p 3](#__pdf:bbb:3) end");
  });

  it("leaves text with no token unchanged", () => {
    const t = "plain assistant response with no anchor";
    expect(replacePdfTokensWithLinks(t)).toBe(t);
  });

  it("leaves legacy [[pdf:foo.pdf]] form untouched", () => {
    const t = "see [[pdf:foo.pdf]] tomorrow";
    expect(replacePdfTokensWithLinks(t)).toBe(t);
  });

  it("the rewritten output contains NO literal [[pdf: substring", () => {
    const out = replacePdfTokensWithLinks(
      "x [[pdf:abc#p9]] y [[pdf:def#p10]] z",
    );
    expect(out.includes("[[pdf:")).toBe(false);
  });
});

describe("parsePdfSentinelHref", () => {
  it("parses a valid sentinel href into paperId + page", () => {
    expect(parsePdfSentinelHref("#__pdf:abc-123:7")).toEqual({
      paperId: "abc-123",
      page: 7,
    });
  });

  it("returns null for non-sentinel hrefs", () => {
    expect(parsePdfSentinelHref("https://example.com")).toBeNull();
    expect(parsePdfSentinelHref("#anchor")).toBeNull();
    expect(parsePdfSentinelHref(undefined)).toBeNull();
  });
});
