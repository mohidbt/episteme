import { describe, expect, it } from "vitest";
import { Editor, generateJSON, type Content, type JSONContent } from "@tiptap/core";
import { createExtensions } from "../extensions";
import { WikiLink } from "./WikiLink";

// Build a Tiptap editor that has the WikiLink node + tiptap-markdown.
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

// Parse markdown → JSONContent using the extension set that includes WikiLink,
// so WikiLink's parse.setup hook registers its markdown-it inline rule. The
// top-level mdToProseMirror helper omits WikiLink by design; this local variant
// is what exercises the parse path under test.
function mdToJSON(md: string): JSONContent {
  const editor = new Editor({
    extensions: [...createExtensions(), WikiLink],
  });
  editor.commands.setContent(md);
  const json = editor.getJSON();
  editor.destroy();
  return json;
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

// Helpers for walking the paragraph children of a parsed doc.
type Child = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string }>; content?: Child[] };
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

describe("WikiLink markdown parse", () => {
  it("parses [[Title]] as a wikiLink node with title attr", () => {
    const json = mdToJSON("see [[Transformers]] today");
    const children = paragraphChildren(json);
    const wiki = children.find((c) => c.type === "wikiLink");
    expect(wiki).toBeDefined();
    expect(wiki?.attrs?.title).toBe("Transformers");
    // Node default for `alias` is `null`.
    expect(wiki?.attrs?.alias ?? null).toBe(null);
    const texts = children.filter((c) => c.type === "text").map((c) => c.text ?? "");
    expect(texts.some((t) => t.includes("see "))).toBe(true);
    expect(texts.some((t) => t.includes(" today"))).toBe(true);
  });

  it("parses [[Title|Alias]] as a wikiLink node with alias attr", () => {
    const json = mdToJSON("see [[Transformers|TF]]");
    const wiki = findNode(json, "wikiLink");
    expect(wiki).toBeDefined();
    expect(wiki?.attrs?.title).toBe("Transformers");
    expect(wiki?.attrs?.alias).toBe("TF");
  });

  it("does not parse [[Title]] inside a code span", () => {
    const json = mdToJSON("use `[[Foo]]` literally");
    const children = paragraphChildren(json);
    expect(children.find((c) => c.type === "wikiLink")).toBeUndefined();
    const codeText = children.find(
      (c) => c.type === "text" && c.marks?.some((m) => m.type === "code"),
    );
    expect(codeText?.text).toBe("[[Foo]]");
  });

  it("does not parse [[Title]] inside a fenced code block", () => {
    const json = mdToJSON("```\n[[Foo]]\n```");
    expect(findNode(json, "wikiLink")).toBeUndefined();
    const codeBlock = findNode(json, "codeBlock");
    expect(codeBlock).toBeDefined();
    const inner = codeBlock?.content?.find((c) => c.type === "text");
    expect(inner?.text).toBe("[[Foo]]");
  });

  it("is idempotent: serialize(parse([[Title]])) === [[Title]]", () => {
    const editor = new Editor({
      extensions: [...createExtensions(), WikiLink],
    });
    editor.commands.setContent("see [[Transformers]] today");
    expect(toMd(editor).trim()).toBe("see [[Transformers]] today");
    editor.destroy();
  });
});
