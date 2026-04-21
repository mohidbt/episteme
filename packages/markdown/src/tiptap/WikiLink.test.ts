import { describe, expect, it } from "vitest";
import { Editor, generateJSON, type Content } from "@tiptap/core";
import { createExtensions } from "../extensions";
import { WikiLink } from "./WikiLink";

// Build a Tiptap editor that has the WikiLink node + tiptap-markdown.
// We don't wire parsing [[..]] → wikiLink node here (that's handled by
// rebuildLinks regex at save time). What we DO test is:
//   given a JSON doc containing a wikiLink node, the markdown serializer
//   writes back a literal `[[title]]` (or `[[title|alias]]`) token.
function makeEditor(content: Content) {
  return new Editor({
    extensions: [...createExtensions(), WikiLink],
    content,
  });
}

function toMd(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown: () => string } };
  return storage.markdown?.getMarkdown() ?? "";
}

describe("WikiLink tiptap node", () => {
  it("serializes a wikiLink node to `[[Title]]` markdown", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            {
              type: "wikiLink",
              attrs: { title: "Transformers", alias: null, targetKind: "note", targetId: null },
            },
          ],
        },
      ],
    });
    const md = toMd(editor);
    expect(md).toContain("[[Transformers]]");
    editor.destroy();
  });

  it("serializes an aliased wikiLink to `[[Title|alias]]`", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "wikiLink",
              attrs: { title: "Transformers", alias: "TF", targetKind: "note", targetId: null },
            },
          ],
        },
      ],
    });
    expect(toMd(editor)).toContain("[[Transformers|TF]]");
    editor.destroy();
  });

  it("renders a pill span with data attrs for parseHTML round-trip", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "wikiLink",
              attrs: { title: "Note A", alias: null, targetKind: "note", targetId: "abc" },
            },
          ],
        },
      ],
    });
    const html = editor.getHTML();
    expect(html).toContain('data-type="wiki-link"');
    expect(html).toContain('data-title="Note A"');
    expect(html).toContain('data-target-id="abc"');
    expect(html).toContain('data-resolved="true"');
    editor.destroy();
  });

  it("renders data-resolved=false when targetId is null", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "wikiLink",
              attrs: { title: "Missing", alias: null, targetKind: "note", targetId: null },
            },
          ],
        },
      ],
    });
    expect(editor.getHTML()).toContain('data-resolved="false"');
    editor.destroy();
  });

  it("parses HTML pill back into a wikiLink node", () => {
    // generateJSON takes raw HTML through Tiptap's HTML parser (not
    // tiptap-markdown's setContent override which treats strings as markdown).
    const json = generateJSON(
      '<p><span data-type="wiki-link" data-title="Alpha" data-alias="A" data-target-kind="note" data-target-id="123" data-resolved="true">Alpha</span></p>',
      [...createExtensions(), WikiLink],
    );
    const para = (json.content ?? [])[0] as { content?: unknown[] };
    const node = (para.content ?? [])[0] as {
      type: string;
      attrs: Record<string, unknown>;
    };
    expect(node.type).toBe("wikiLink");
    expect(node.attrs.title).toBe("Alpha");
    expect(node.attrs.alias).toBe("A");
    expect(node.attrs.targetKind).toBe("note");
    expect(node.attrs.targetId).toBe("123");
  });
});
