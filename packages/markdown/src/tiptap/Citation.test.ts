import { describe, expect, it } from "vitest";
import { Editor, type Content } from "@tiptap/core";
import { mdToProseMirror, proseMirrorToMd, createExtensions } from "../index.js";
import type { JSONContent } from "@tiptap/core";
import { Citation } from "./Citation";

function makeEditor(content: Content) {
  return new Editor({
    extensions: [...createExtensions(), Citation],
    content,
  });
}

describe("Citation node", () => {
  it("MD serializes citation node -> [@citekey]", () => {
    // Build a doc with a citation node directly as JSON and serialize to MD
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "citation",
              attrs: {
                citekey: "doe2024",
                title: "A Great Paper",
                authors: ["Doe, J."],
                year: "2024",
              },
            },
          ],
        },
      ],
    };
    const md = proseMirrorToMd(doc);
    expect(md).toContain("[@doe2024]");
  });

  it("round-trips: parse(serialize(node)) has the same citekey", () => {
    const md = "See [@vaswani2017] for details.\n";
    const doc = mdToProseMirror(md);
    const back = proseMirrorToMd(doc);
    expect(back).toContain("[@vaswani2017]");
    // Re-parse the serialized form and verify citekey is preserved
    const doc2 = mdToProseMirror(back);
    const back2 = proseMirrorToMd(doc2);
    expect(back2).toContain("[@vaswani2017]");
  });

  it("MD parse: [@citekey] in paragraph becomes citation node with correct attrs", () => {
    const md = "See [@doe2024] here.\n";
    const doc = mdToProseMirror(md);
    const para = doc.content?.[0];
    expect(para?.type).toBe("paragraph");
    const inlineNodes = para?.content ?? [];
    const citation = inlineNodes.find((n: JSONContent) => n.type === "citation");
    expect(citation).toBeTruthy();
    expect(citation?.attrs?.citekey).toBe("doe2024");
  });

  it("renderHTML: citation with bibIndex=2 produces <sup> element with text [2]", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "citation",
              attrs: {
                citekey: "doe2024",
                title: "A Great Paper",
                authors: ["Doe, J."],
                year: "2024",
                bibIndex: 2,
              },
            },
          ],
        },
      ],
    });
    const html = editor.getHTML();
    editor.destroy();
    expect(html).toContain("<sup");
    expect(html).toContain("[2]");
    expect(html).not.toContain("[@doe2024]");
  });

  it("renderHTML: citation with bibIndex=null renders [?]", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "citation",
              attrs: {
                citekey: "smith2020",
                title: "Some Paper",
                authors: ["Smith, J."],
                year: "2020",
                bibIndex: null,
              },
            },
          ],
        },
      ],
    });
    const html = editor.getHTML();
    editor.destroy();
    expect(html).toContain("<sup");
    expect(html).toContain("[?]");
  });

  it("MD serializer does NOT include bibIndex in markdown output", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "citation",
              attrs: {
                citekey: "doe2024",
                title: "A Great Paper",
                authors: ["Doe, J."],
                year: "2024",
                bibIndex: 3,
              },
            },
          ],
        },
      ],
    };
    const md = proseMirrorToMd(doc);
    expect(md).toContain("[@doe2024]");
    expect(md).not.toContain("bibIndex");
    expect(md).not.toContain("[3]");
  });

  it("does NOT parse [@citekey] inside code fence as citation", () => {
    const md = "```\n[@notacite]\n```\n";
    const doc = mdToProseMirror(md);
    const back = proseMirrorToMd(doc);
    // Should remain as plain text inside code block, not a citation node
    expect(back).toContain("[@notacite]");
    // No citation node in the code_block
    const codeBlock = doc.content?.find((n: JSONContent) => n.type === "codeBlock");
    expect(codeBlock).toBeTruthy();
    // All content inside code_block should be text, no citation nodes
    const hasCitationInCode = (codeBlock?.content ?? []).some(
      (n: JSONContent) => n.type === "citation"
    );
    expect(hasCitationInCode).toBe(false);
  });
});
