import { describe, expect, it } from "vitest";
import { mdToProseMirror, proseMirrorToMd } from "../index.js";

const samples = [
  "# Heading\n\nPlain paragraph.\n",
  "- item 1\n- item 2\n  - nested\n",
  "- [ ] todo unchecked\n- [x] todo checked\n",
  "> quote\n\n`inline code`\n\n```js\nconsole.log('hi')\n```\n",
  "[link](https://example.com)\n\n**bold** _italic_ ~~strike~~\n",
];

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

describe("markdown round-trip", () => {
  for (const md of samples) {
    it(`round-trips: ${JSON.stringify(md).slice(0, 40)}`, () => {
      const doc = mdToProseMirror(md);
      const back = proseMirrorToMd(doc);
      expect(norm(back)).toBe(norm(md));
    });
  }

  it("round-trips [[wikilink]] byte-for-byte (plain text passthrough)", () => {
    const md = "See [[wikilink]] here.\n";
    const doc = mdToProseMirror(md);
    const back = proseMirrorToMd(doc);
    expect(norm(back)).toBe(norm(md));
  });

  it("returns a valid empty ProseMirror doc for empty string", () => {
    const doc = mdToProseMirror("") as { type: string; content?: unknown[] };
    expect(doc).toBeTruthy();
    expect(doc.type).toBe("doc");
  });
});
