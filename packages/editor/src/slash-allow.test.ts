/**
 * Regression locks — slash command `allow` predicate.
 *
 * Tests verify that `isInsideCodeBlock` and `isPrecededByBackslash` work
 * correctly so the Suggestion plugin's `allow` predicate suppresses the slash
 * command trigger in code fences and after backslash escapes.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { createExtensions, WikiLink } from "@episteme/markdown";
import { isInsideCodeBlock, isPrecededByBackslash } from "./extensions";

function makeEditor(content?: object) {
  return new Editor({
    extensions: [...createExtensions(), WikiLink],
    content: content ?? { type: "doc", content: [{ type: "paragraph" }] },
  });
}

describe("isInsideCodeBlock", () => {
  it("returns false when cursor is in a regular paragraph", () => {
    const editor = makeEditor();
    // Cursor is at position 1 (inside the empty paragraph)
    const { state } = editor;
    expect(isInsideCodeBlock(state)).toBe(false);
    editor.destroy();
  });

  it("returns true when cursor is inside a code_block node", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: null },
          content: [{ type: "text", text: "const x = 1" }],
        },
      ],
    });
    // Move cursor inside the code block (position 2 = inside the codeBlock)
    editor.commands.setTextSelection(2);
    const { state } = editor;
    expect(isInsideCodeBlock(state)).toBe(true);
    editor.destroy();
  });
});

describe("isPrecededByBackslash", () => {
  it("returns false when the character before cursor is not backslash", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "hello/" }],
        },
      ],
    });
    // Cursor at end of "hello/" — position 7 (1 doc + 1 para open + 6 chars)
    editor.commands.setTextSelection(7);
    const { state } = editor;
    expect(isPrecededByBackslash(state)).toBe(false);
    editor.destroy();
  });

  it("returns true when the character immediately before cursor is backslash", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "hello\\/" }],
        },
      ],
    });
    // Position cursor after the backslash (before the /): pos = 1(doc) + 1(para) + 6(chars "hello\")
    // text: "hello\/" — 7 chars. cursor at pos 8 is after \ and before /
    // Let's place cursor right after the backslash character
    editor.commands.setTextSelection(7);
    const { state } = editor;
    // The char at position 6 (0-indexed in text) is "\"
    expect(isPrecededByBackslash(state)).toBe(true);
    editor.destroy();
  });
});
