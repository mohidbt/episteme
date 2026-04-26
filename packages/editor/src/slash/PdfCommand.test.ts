import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { createExtensions } from "@episteme/markdown";
import { insertPdfEmbed } from "./PdfCommand";
import type { JSONContent } from "@tiptap/core";

function makeEditor() {
  // PdfEmbed is already included in createExtensions()
  return new Editor({
    extensions: createExtensions(),
    content: {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
  });
}

function findPdfEmbedNode(doc: JSONContent): JSONContent | undefined {
  return doc.content?.find((n: JSONContent) => n.type === "pdfEmbed");
}

describe("insertPdfEmbed", () => {
  it("inserts a pdfEmbed node at cursor with correct pdfId and title", () => {
    const editor = makeEditor();
    insertPdfEmbed(editor, { pdfId: "abc-123", title: "My Paper", page: null });
    const doc = editor.getJSON();
    editor.destroy();
    const node = findPdfEmbedNode(doc);
    expect(node).toBeTruthy();
    expect(node?.attrs?.pdfId).toBe("abc-123");
    expect(node?.attrs?.title).toBe("My Paper");
    expect(node?.attrs?.page).toBeNull();
  });

  it("inserts a pdfEmbed node with page when page is provided", () => {
    const editor = makeEditor();
    insertPdfEmbed(editor, { pdfId: "xyz-789", title: "Another Paper", page: 5 });
    const doc = editor.getJSON();
    editor.destroy();
    const node = findPdfEmbedNode(doc);
    expect(node).toBeTruthy();
    expect(node?.attrs?.page).toBe(5);
  });

  it("doc contains a pdfEmbed node (block level)", () => {
    const editor = makeEditor();
    insertPdfEmbed(editor, { pdfId: "test-1", title: "Test", page: null });
    const doc = editor.getJSON();
    editor.destroy();
    const types = doc.content?.map((n: JSONContent) => n.type) ?? [];
    expect(types).toContain("pdfEmbed");
  });
});
