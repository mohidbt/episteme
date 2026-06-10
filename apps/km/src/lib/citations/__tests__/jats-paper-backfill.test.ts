import { describe, it, expect } from "vitest";
import { shouldRewriteAbstract } from "../jats-paper-backfill";

describe("shouldRewriteAbstract", () => {
  it("rewrites rows containing JATS tags", () => {
    const r = shouldRewriteAbstract("<jats:p>Hello world</jats:p>");
    expect(r.rewrite).toBe(true);
    expect(r.clean).toBe("Hello world");
  });

  it("rewrites rows containing only HTML entities", () => {
    const r = shouldRewriteAbstract("Tom &amp; Jerry");
    expect(r.rewrite).toBe(true);
    expect(r.clean).toBe("Tom & Jerry");
  });

  it("skips already-clean rows", () => {
    const r = shouldRewriteAbstract("Plain abstract text.");
    expect(r.rewrite).toBe(false);
    expect(r.clean).toBe("Plain abstract text.");
  });

  it("skips empty strings", () => {
    const r = shouldRewriteAbstract("");
    expect(r.rewrite).toBe(false);
  });

  it("skips null", () => {
    const r = shouldRewriteAbstract(null);
    expect(r.rewrite).toBe(false);
    expect(r.clean).toBe("");
  });

  it("rewrites multi-paragraph JATS with whitespace collapse", () => {
    const r = shouldRewriteAbstract(
      "<jats:p>para one</jats:p>\n\n  <jats:p>para two</jats:p>",
    );
    expect(r.rewrite).toBe(true);
    expect(r.clean).toBe("para one para two");
  });
});
