import { describe, expect, it } from "vitest";
import { Editor, generateJSON, type JSONContent } from "@tiptap/core";
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

// Parse markdown → JSONContent using the extension set that includes TagMark,
// so TagMark's parse.setup hook registers its markdown-it inline rule. The
// top-level mdToProseMirror helper omits TagMark by design; this local variant
// is what exercises the parse path under test.
function mdToJSON(md: string): JSONContent {
  const editor = new Editor({
    extensions: [...createExtensions(), TagMark],
  });
  editor.commands.setContent(md);
  const json = editor.getJSON();
  editor.destroy();
  return json;
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

// Helpers for walking the paragraph children of a parsed doc.
type Child = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: Child[];
};
function paragraphChildren(json: JSONContent): Child[] {
  const para = (json.content ?? [])[0] as { content?: Child[] } | undefined;
  return para?.content ?? [];
}
function findNode(json: JSONContent, type: string): Child | undefined {
  const walk = (nodes: Child[] | undefined): Child | undefined => {
    if (!nodes) return undefined;
    for (const n of nodes) {
      if (n.type === type) return n;
      const hit = walk(n.content);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(json.content as Child[] | undefined);
}
function findTaggedText(json: JSONContent, text: string): Child | undefined {
  const children = paragraphChildren(json);
  return children.find(
    (c) =>
      c.type === "text" &&
      c.text === text &&
      (c.marks?.some((m) => m.type === "tag") ?? false),
  );
}
function anyTagMark(json: JSONContent): boolean {
  const walk = (nodes: Child[] | undefined): boolean => {
    if (!nodes) return false;
    for (const n of nodes) {
      if (n.marks?.some((m) => m.type === "tag")) return true;
      if (walk(n.content)) return true;
    }
    return false;
  };
  return walk(json.content as Child[] | undefined);
}

describe("TagMark markdown parse", () => {
  it('parses "#ml" into a text node with a tag mark', () => {
    const json = mdToJSON("i like #ml");
    const tagged = findTaggedText(json, "#ml");
    expect(tagged).toBeDefined();
    const mark = tagged?.marks?.find((m) => m.type === "tag");
    expect(mark?.attrs?.tag).toBe("ml");
  });

  it('parses multiple tags "#ml and #deep-learning"', () => {
    const json = mdToJSON("notes on #ml and #deep-learning");
    const ml = findTaggedText(json, "#ml");
    const dl = findTaggedText(json, "#deep-learning");
    expect(ml?.marks?.find((m) => m.type === "tag")?.attrs?.tag).toBe("ml");
    expect(dl?.marks?.find((m) => m.type === "tag")?.attrs?.tag).toBe(
      "deep-learning",
    );
  });

  it('does not parse "issue#123" (# preceded by a word char)', () => {
    const json = mdToJSON("issue#123");
    expect(anyTagMark(json)).toBe(false);
  });

  it('does not parse "#123" (digit after #)', () => {
    const json = mdToJSON("#123");
    expect(anyTagMark(json)).toBe(false);
  });

  it("does not parse inside a code span", () => {
    const json = mdToJSON("use `#ml` literally");
    const children = paragraphChildren(json);
    const codeText = children.find(
      (c) => c.type === "text" && c.marks?.some((m) => m.type === "code"),
    );
    expect(codeText?.text).toBe("#ml");
    expect(codeText?.marks?.some((m) => m.type === "tag")).not.toBe(true);
    expect(anyTagMark(json)).toBe(false);
  });

  it("does not parse inside a fenced code block", () => {
    const json = mdToJSON("```\n#ml\n```");
    const codeBlock = findNode(json, "codeBlock");
    expect(codeBlock).toBeDefined();
    const inner = codeBlock?.content?.find((c) => c.type === "text");
    expect(inner?.text).toBe("#ml");
    expect(anyTagMark(json)).toBe(false);
  });

  it('is idempotent: round-trip "i like #ml" stays "i like #ml"', () => {
    const editor = new Editor({
      extensions: [...createExtensions(), TagMark],
    });
    editor.commands.setContent("i like #ml");
    expect(toMd(editor).trim()).toBe("i like #ml");
    editor.destroy();
  });
});
