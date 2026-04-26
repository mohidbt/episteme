/**
 * Regression test: BibliographyHeading must be in the real editorExtensions()
 * schema so the structural sentinel is available in production.
 *
 * TDD cycle: RED first — this test MUST fail before BibliographyHeading is
 * wired into editorExtensions(). After the fix it goes GREEN.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions } from "../extensions";
import { insertCitation } from "./CiteCommand";
import type { JSONContent } from "@tiptap/core";

function makeProductionEditor() {
  return new Editor({
    // Use the real production extension factory — NOT a manually assembled list
    extensions: editorExtensions(),
    content: {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
  });
}

function countNodesByType(doc: JSONContent, typeName: string): number {
  let count = 0;
  function walk(node: JSONContent) {
    if (node.type === typeName) count++;
    for (const child of node.content ?? []) walk(child);
  }
  walk(doc);
  return count;
}

describe("insertCitation — production schema regression", () => {
  it("editorExtensions() schema includes bibliographyHeading node type", () => {
    const editor = makeProductionEditor();
    const hasBibType = "bibliographyHeading" in editor.schema.nodes;
    editor.destroy();
    // This FAILS before BibliographyHeading is added to editorExtensions()
    expect(hasBibType).toBe(true);
  });

  it("two insertCitation calls produce exactly one bibliographyHeading node using production extensions", () => {
    const editor = makeProductionEditor();

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

    // With BibliographyHeading in schema, the structural sentinel is used.
    // Without it, `state.schema.nodes.bibliographyHeading` is undefined so
    // insertCitation falls back to a plain paragraph — this node count would be 0.
    const bibHeadingCount = countNodesByType(doc, "bibliographyHeading");
    expect(bibHeadingCount).toBe(1);
  });

  it("bibliography heading rendered with sentinel attribute in production schema", () => {
    const editor = makeProductionEditor();

    insertCitation(editor, {
      citekey: "vaswani2017",
      title: "Attention Is All You Need",
      authors: ["Vaswani, A."],
      year: "2017",
    });

    const html = editor.getHTML();
    editor.destroy();

    // BibliographyHeading renders data-bib-heading="true" — only present if the
    // custom node is registered in the schema.
    expect(html).toContain('data-bib-heading="true"');
  });
});
