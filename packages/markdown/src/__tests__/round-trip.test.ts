import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { mdToProseMirror, proseMirrorToMd } from "../index.js";

const samples = [
  "# Heading\n\nPlain paragraph.\n",
  "- item 1\n- item 2\n  - nested\n",
  "- [ ] todo unchecked\n\n- [x] todo checked\n",
  "> quote\n\n`inline code`\n\n```js\nconsole.log('hi')\n```\n",
  "[link](https://example.com)\n\n**bold** _italic_ ~~strike~~\n",
];

// Preserve paragraph boundaries (blank lines) while collapsing whitespace
// within a paragraph, so samples that differ only in line-wrap/indent match.
const norm = (s: string) =>
  s
    .trim()
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " "))
    .join("\n\n");

describe("markdown round-trip", () => {
  for (const md of samples) {
    it(`round-trips: ${JSON.stringify(md).slice(0, 40)}`, () => {
      const doc: JSONContent = mdToProseMirror(md);
      const back = proseMirrorToMd(doc);
      expect(norm(back)).toBe(norm(md));
    });
  }

  it("round-trips [[wikilink]] byte-for-byte (plain text passthrough)", () => {
    const md = "See [[wikilink]] here.\n";
    const doc = mdToProseMirror(md);
    const back = proseMirrorToMd(doc);
    expect(back).toBe("See [[wikilink]] here.");
  });

  it("preserves `*` inside inline code (no italic rewrite)", () => {
    const md = "See `a * b * c` inline.\n";
    const doc = mdToProseMirror(md);
    const back = proseMirrorToMd(doc);
    expect(back).toContain("`a * b * c`");
  });

  it("preserves `*stars*` inside fenced code blocks", () => {
    const md = "```\nfoo *stars* bar\n```\n";
    const doc = mdToProseMirror(md);
    const back = proseMirrorToMd(doc);
    expect(back).toContain("foo *stars* bar");
    expect(back).not.toContain("_stars_");
  });

  it("returns a valid empty ProseMirror doc for empty string", () => {
    const doc = mdToProseMirror("");
    expect(doc).toBeTruthy();
    expect(doc.type).toBe("doc");
  });
});
