import { describe, expect, it } from "vitest";
import { Editor, generateJSON } from "@tiptap/core";
import { createExtensions } from "../extensions";
import { TagMark } from "./TagMark";

function makeEditor(content: string) {
  return new Editor({
    extensions: [...createExtensions(), TagMark],
    content,
  });
}

function toMd(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown: () => string } };
  return storage.markdown?.getMarkdown() ?? "";
}

describe("TagMark", () => {
  it("round-trips #tag through the editor: MD stays literal #ml", () => {
    const editor = makeEditor("i like #ml");
    const md = toMd(editor);
    expect(md.trim()).toBe("i like #ml");
    editor.destroy();
  });

  it("round-trips multiple tags in a paragraph", () => {
    const editor = makeEditor("notes on #ml and #deep-learning");
    const md = toMd(editor);
    expect(md.trim()).toBe("notes on #ml and #deep-learning");
    editor.destroy();
  });

  it("parses HTML span with data-type=tag back to the correct mark", () => {
    const json = generateJSON(
      '<p>i like <span data-type="tag" data-tag="ml">#ml</span></p>',
      [...createExtensions(), TagMark],
    );
    const para = (json.content ?? [])[0] as { content?: unknown[] };
    const tagNode = (para.content ?? []).find(
      (n) => (n as { marks?: unknown[] }).marks?.some(
        (m) => (m as { type: string }).type === "tag",
      ),
    ) as { marks?: { type: string; attrs: { tag: string } }[] } | undefined;
    expect(tagNode).toBeDefined();
    const mark = tagNode?.marks?.find((m) => m.type === "tag");
    expect(mark?.attrs.tag).toBe("ml");
  });

  it("HTML span with data-type=tag round-trips to #tag MD", () => {
    // Parse the HTML into a ProseMirror JSON doc, then build an editor from
    // that JSON (same pattern as WikiLink.test.ts). This exercises parseHTML.
    const json = generateJSON(
      '<p>i like <span data-type="tag" data-tag="ml">#ml</span></p>',
      [...createExtensions(), TagMark],
    );
    const editor = new Editor({
      extensions: [...createExtensions(), TagMark],
      content: json,
    });
    const md = toMd(editor);
    expect(md.trim()).toBe("i like #ml");
    editor.destroy();
  });
});
