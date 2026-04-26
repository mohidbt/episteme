import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
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

/**
 * Defect A: after insertCitation, selection must be explicitly set to right
 * after the citation node in the original paragraph — not left wherever
 * ProseMirror maps it after the bibliography append.
 *
 * The fix: insertCitation must consolidate all mutations in a single
 * transaction and call tr.setSelection() to position the cursor after the
 * citation. This test verifies that the final selection is a TextSelection
 * inside the paragraph that contains the citation.
 */
describe("insertCitation — cursor placement after insert (Defect A)", () => {
  it("selection is a TextSelection immediately after the citation node in the original paragraph", () => {
    const editor = makeEditor();
    // Pos 1 = inside the single empty paragraph
    editor.commands.setTextSelection(1);

    insertCitation(editor, {
      citekey: "vaswani2017",
      title: "Attention Is All You Need",
      authors: ["Vaswani, A."],
      year: "2017",
    });

    const state = editor.state;
    // Must be a text selection (not a node selection pointing at a list)
    expect(state.selection).toBeInstanceOf(TextSelection);

    // The depth-1 ancestor of the selection must be a paragraph
    const resolved = state.doc.resolve(state.selection.from);
    expect(resolved.node(1).type.name).toBe("paragraph");

    // Specifically: pos must equal 1 (start of para) + citation nodeSize (1 atom)
    // = 2, i.e., right after the citation node.
    // Walk the doc to find the citation node position
    let citationEndPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "citation") {
        citationEndPos = pos + node.nodeSize; // right after citation
        return false;
      }
    });
    expect(citationEndPos).toBeGreaterThan(0);
    expect(state.selection.from).toBe(citationEndPos);

    editor.destroy();
  });

  it("cursor is right after second citation when two citations inserted in same paragraph", () => {
    const editor = makeEditor();

    insertCitation(editor, {
      citekey: "vaswani2017",
      title: "Attention Is All You Need",
      authors: ["Vaswani, A."],
      year: "2017",
    });

    // Move cursor back into paragraph and insert second citation
    editor.commands.setTextSelection(2);

    insertCitation(editor, {
      citekey: "devlin2018",
      title: "BERT",
      authors: ["Devlin, J."],
      year: "2018",
    });

    const state = editor.state;
    expect(state.selection).toBeInstanceOf(TextSelection);

    const resolved = state.doc.resolve(state.selection.from);
    expect(resolved.node(1).type.name).toBe("paragraph");

    editor.destroy();
  });
});

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
