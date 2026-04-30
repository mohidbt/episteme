/**
 * Task #6 — markdown task list shortcut.
 *
 * Typing `[]` (or `[ ]`) followed by space at the start of an empty paragraph
 * converts that line into an unchecked TaskItem, mirroring the standard
 * markdown shortcut for `- ` → bullet list. `[x] ` produces a checked item.
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { editorExtensions } from "./extensions";

function makeEditor() {
  return new Editor({
    extensions: editorExtensions(),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
}

function findFirst(doc: JSONContent, type: string): JSONContent | undefined {
  if (doc.type === type) return doc;
  for (const c of doc.content ?? []) {
    const hit = findFirst(c, type);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Simulate user-typed text one char at a time so ProseMirror's `inputRules`
 * plugin (registered via `handleTextInput`) gets a chance to fire on the
 * trailing trigger char. Bare `tr.insertText` dispatches DO NOT fire input
 * rules — they're only triggered through the view's `handleTextInput`
 * pipeline.
 */
function typeText(editor: Editor, text: string) {
  const view = editor.view;
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = (view.someProp("handleTextInput") as
      | ((view: typeof editor.view, from: number, to: number, text: string) => boolean)
      | undefined)?.(view, from, to, ch);
    if (!handled) {
      view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  }
}

describe("TaskListShortcut", () => {
  it("typing `[] ` at start of empty paragraph creates a TaskItem", () => {
    const editor = makeEditor();
    typeText(editor, "[] ");
    const doc = editor.getJSON();
    editor.destroy();
    expect(findFirst(doc, "taskList")).toBeTruthy();
    const taskItem = findFirst(doc, "taskItem");
    expect(taskItem).toBeTruthy();
    expect(taskItem?.attrs?.checked).toBe(false);
  });

  it("typing `[ ] ` at start of empty paragraph creates a TaskItem", () => {
    const editor = makeEditor();
    typeText(editor, "[ ] ");
    const doc = editor.getJSON();
    editor.destroy();
    expect(findFirst(doc, "taskList")).toBeTruthy();
    expect(findFirst(doc, "taskItem")?.attrs?.checked).toBe(false);
  });

  it("typing `[x] ` produces a checked TaskItem", () => {
    const editor = makeEditor();
    typeText(editor, "[x] ");
    const doc = editor.getJSON();
    editor.destroy();
    expect(findFirst(doc, "taskItem")?.attrs?.checked).toBe(true);
  });

  it("does NOT trigger when `[] ` appears mid-paragraph (after other text)", () => {
    const editor = makeEditor();
    typeText(editor, "hello [] ");
    const doc = editor.getJSON();
    editor.destroy();
    expect(findFirst(doc, "taskList")).toBeUndefined();
  });
});
