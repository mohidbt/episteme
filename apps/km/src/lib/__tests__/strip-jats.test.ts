import { describe, it, expect } from "vitest";
import { stripJats, decodeEntities, sanitizeAbstract } from "../strip-jats";

describe("stripJats", () => {
  it("removes <jats:*> open and close tags", () => {
    expect(stripJats("<jats:p>foo</jats:p>")).toBe("foo");
  });

  it("collapses whitespace runs left over from stripped tags", () => {
    expect(stripJats("<jats:p>a</jats:p>\n\n  <jats:p>b</jats:p>")).toBe("a b");
  });
});

describe("decodeEntities", () => {
  it("decodes the common named entities", () => {
    expect(decodeEntities("Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;ok&#39;")).toBe(
      "Tom & Jerry <3 \"hi\" 'ok'",
    );
  });

  it("decodes numeric and hex entities", () => {
    expect(decodeEntities("&#8211; and &#x2014;")).toBe("– and —");
  });

  it("leaves unknown entities untouched", () => {
    expect(decodeEntities("&notarealentity;")).toBe("&notarealentity;");
  });
});

describe("sanitizeAbstract", () => {
  it("strips JATS and decodes entities together", () => {
    expect(sanitizeAbstract("<jats:p>Tom &amp; Jerry</jats:p>")).toBe("Tom & Jerry");
  });

  it("returns empty string for null/undefined", () => {
    expect(sanitizeAbstract(null)).toBe("");
    expect(sanitizeAbstract(undefined)).toBe("");
  });
});
