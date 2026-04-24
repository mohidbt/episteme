import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { createExtensions } from "@episteme/markdown";
import { Citation } from "@episteme/markdown";
import { insertCitation } from "./CiteCommand";
import { BibliographyHeading } from "./BibliographyHeading";
import type { JSONContent } from "@tiptap/core";

function makeEditor() {
  return new Editor({
    // Include BibliographyHeading so the sentinel node type is in schema
    extensions: [...createExtensions(), Citation, BibliographyHeading],
    content: {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
  });
}

function countBibliographyBlocks(doc: JSONContent): number {
  const content = doc.content ?? [];
  return content.filter((node) => node.type === "bibliographyBlock").length;
}

function countBibliographyByText(doc: JSONContent): number {
  // Count paragraphs whose text is exactly "Bibliography"
  const content = doc.content ?? [];
  return content.filter((node) => {
    const text = node.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "";
    return text === "Bibliography";
  }).length;
}

function getOrderedListsAfterBib(doc: JSONContent): JSONContent[] {
  const content = doc.content ?? [];
  const bibIdx = content.findIndex((node) => {
    const text = node.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "";
    return text === "Bibliography";
  });
  if (bibIdx === -1) return [];
  const list = content[bibIdx + 1];
  return list?.type === "orderedList" ? [list] : [];
}

describe("insertCitation — bibliography dedup", () => {
  it("two insertCitation calls produce exactly one bibliography block", () => {
    const editor = makeEditor();

    insertCitation(editor, {
      citekey: "vaswani2017",
      title: "Attention Is All You Need",
      authors: ["Vaswani, A.", "Shazeer, N."],
      year: "2017",
    });

    insertCitation(editor, {
      citekey: "devlin2018",
      title: "BERT",
      authors: ["Devlin, J."],
      year: "2018",
    });

    const doc = editor.getJSON();
    editor.destroy();

    // Exactly one "Bibliography" heading paragraph in the doc
    const bibCount = countBibliographyByText(doc);
    expect(bibCount).toBe(1);
  });

  it("two insertCitation calls produce an ordered list with exactly two items", () => {
    const editor = makeEditor();

    insertCitation(editor, {
      citekey: "vaswani2017",
      title: "Attention Is All You Need",
      authors: ["Vaswani, A.", "Shazeer, N."],
      year: "2017",
    });

    insertCitation(editor, {
      citekey: "devlin2018",
      title: "BERT",
      authors: ["Devlin, J."],
      year: "2018",
    });

    const doc = editor.getJSON();
    editor.destroy();

    const lists = getOrderedListsAfterBib(doc);
    expect(lists).toHaveLength(1);
    const listItems = lists[0].content ?? [];
    expect(listItems).toHaveLength(2);
  });

  it("bibliography is detected structurally (sentinel attr), not by plain text match", () => {
    // After first insert, the bibliography paragraph has a sentinel attribute
    // data-bib-heading="true" — so detection doesn't rely on text "Bibliography"
    // matching. This test checks the attr is present in the HTML.
    const editor = makeEditor();

    insertCitation(editor, {
      citekey: "vaswani2017",
      title: "Attention Is All You Need",
      authors: ["Vaswani, A."],
      year: "2017",
    });

    const html = editor.getHTML();
    editor.destroy();

    // The bibliography heading paragraph should have the sentinel attribute
    expect(html).toContain('data-bib-heading="true"');
  });
});
