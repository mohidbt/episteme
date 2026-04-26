import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions } from "./extensions";
import { MdPaste } from "./MdPaste";

/**
 * Build a headless Tiptap editor with all editor extensions plus MdPaste.
 */
function makeEditor() {
  return new Editor({
    extensions: [...editorExtensions(), MdPaste],
  });
}

/**
 * Simulate a paste event by calling handlePaste directly via someProp.
 * Returns true if the handler intercepted the paste, false if it deferred.
 */
function simulatePaste(
  editor: Editor,
  plain: string,
  html?: string,
): boolean {
  const handlePaste = editor.view.someProp("handlePaste") as
    | ((view: unknown, event: Event, slice: unknown) => boolean)
    | undefined;

  if (!handlePaste) return false;

  const clipboardData = {
    getData: (type: string) => {
      if (type === "text/plain") return plain;
      if (type === "text/html") return html ?? "";
      return "";
    },
    types: html ? ["text/plain", "text/html"] : ["text/plain"],
  };

  const event = Object.assign(new Event("paste"), { clipboardData });
  return handlePaste(editor.view, event, null);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function hasNodeType(editor: Editor, type: string): boolean {
  const json = editor.getJSON();
  const walk = (nodes: unknown[] | undefined): boolean => {
    if (!nodes) return false;
    for (const n of nodes as Array<{ type?: string; content?: unknown[] }>) {
      if (n.type === type) return true;
      if (walk(n.content)) return true;
    }
    return false;
  };
  return walk(json.content as unknown[]);
}

function getNodeByType(
  editor: Editor,
  type: string,
): Record<string, unknown> | undefined {
  const json = editor.getJSON();
  const walk = (
    nodes: unknown[] | undefined,
  ): Record<string, unknown> | undefined => {
    if (!nodes) return undefined;
    for (const n of nodes as Array<{
      type?: string;
      content?: unknown[];
      attrs?: Record<string, unknown>;
    }>) {
      if (n.type === type) return n as Record<string, unknown>;
      const hit = walk(n.content);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(json.content as unknown[]);
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe("MdPaste extension — does NOT intercept", () => {
  it("single-line plain text without MD markers → returns false", () => {
    const editor = makeEditor();
    const intercepted = simulatePaste(editor, "Just normal text");
    expect(intercepted).toBe(false);
    editor.destroy();
  });

  it("paste with text/html present → returns false (defer to Tiptap default)", () => {
    const editor = makeEditor();
    const intercepted = simulatePaste(
      editor,
      "# Heading\n\nsome text",
      "<h1>Heading</h1><p>some text</p>",
    );
    expect(intercepted).toBe(false);
    editor.destroy();
  });

  it("paste larger than 200 KB → returns false", () => {
    const editor = makeEditor();
    const huge = "# Title\n\n" + "x".repeat(200 * 1024 + 1);
    const intercepted = simulatePaste(editor, huge);
    expect(intercepted).toBe(false);
    editor.destroy();
  });
});

describe("MdPaste extension — intercepts and converts", () => {
  it("multi-line heading + bold + link → heading node in doc", () => {
    const editor = makeEditor();
    const intercepted = simulatePaste(
      editor,
      "# Heading\n\n**bold** text\n\n[link](https://x.com)",
    );
    expect(intercepted).toBe(true);
    expect(hasNodeType(editor, "heading")).toBe(true);
    editor.destroy();
  });

  it("[[Note]] reference with newline → wikiLink node with correct title", () => {
    const editor = makeEditor();
    const intercepted = simulatePaste(
      editor,
      "Some [[Note]] reference\n\nNext line",
    );
    expect(intercepted).toBe(true);
    expect(hasNodeType(editor, "wikiLink")).toBe(true);
    const node = getNodeByType(editor, "wikiLink");
    expect(node?.attrs).toMatchObject({ title: "Note" });
    editor.destroy();
  });

  it("[@vaswani2017] citation with newline → citation node with correct citekey", () => {
    const editor = makeEditor();
    const intercepted = simulatePaste(
      editor,
      "Citation [@vaswani2017] here\n\nNext line",
    );
    expect(intercepted).toBe(true);
    expect(hasNodeType(editor, "citation")).toBe(true);
    const node = getNodeByType(editor, "citation");
    expect(node?.attrs).toMatchObject({ citekey: "vaswani2017" });
    editor.destroy();
  });

  it("<!-- episteme:pdf --> comment → pdfEmbed node with correct pdfId and title", () => {
    const editor = makeEditor();
    const intercepted = simulatePaste(
      editor,
      '<!-- episteme:pdf id="abc" title="Foo" -->',
    );
    expect(intercepted).toBe(true);
    expect(hasNodeType(editor, "pdfEmbed")).toBe(true);
    const node = getNodeByType(editor, "pdfEmbed");
    expect(node?.attrs).toMatchObject({ pdfId: "abc", title: "Foo" });
    editor.destroy();
  });

  it("fenced code block → codeBlock node in doc", () => {
    const editor = makeEditor();
    const intercepted = simulatePaste(
      editor,
      "```js\nconsole.log('hi')\n```",
    );
    expect(intercepted).toBe(true);
    expect(hasNodeType(editor, "codeBlock")).toBe(true);
    editor.destroy();
  });

  it("two plain prose paragraphs → at least 2 paragraph nodes (preserveWhitespace regression)", () => {
    const editor = makeEditor();
    const intercepted = simulatePaste(
      editor,
      "First paragraph text.\n\nSecond paragraph text.",
    );
    expect(intercepted).toBe(true);
    const json = editor.getJSON();
    const paragraphs = (
      json.content as Array<{ type: string }> | undefined
    )?.filter((n) => n.type === "paragraph");
    expect(paragraphs?.length).toBeGreaterThanOrEqual(2);
    editor.destroy();
  });

  it("ATX heading marker → heading node in doc", () => {
    const editor = makeEditor();
    const intercepted = simulatePaste(editor, "## Section heading\n\nBody.");
    expect(intercepted).toBe(true);
    expect(hasNodeType(editor, "heading")).toBe(true);
    editor.destroy();
  });

  it("bullet list markdown → bulletList node in doc", () => {
    const editor = makeEditor();
    const intercepted = simulatePaste(
      editor,
      "- item one\n- item two\n- item three",
    );
    expect(intercepted).toBe(true);
    expect(hasNodeType(editor, "bulletList")).toBe(true);
    editor.destroy();
  });
});
