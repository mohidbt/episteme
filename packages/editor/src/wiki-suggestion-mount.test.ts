/**
 * GSD-81 regression: typing `[[` must activate the WikiLink Suggestion plugin
 * and call the configured `render().onStart`. On prod the suggestion
 * decoration appears (text wraps in <span class="suggestion">) but `onStart`
 * never fires — the picker popover never mounts and no `/api/wiki-link/search`
 * is issued.
 *
 * Repro inside vitest's jsdom: build the real `editorExtensions({
 * wikiLinkSuggestion })` stack, type `[[` into a fresh Editor, and assert
 * that `onStart` was called.
 */
import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions, type WikiLinkSuggestion } from "./extensions";

function typeText(editor: Editor, text: string) {
  for (const ch of text) {
    const view = editor.view;
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (h) =>
      (h as (...args: unknown[]) => boolean)(view, from, to, ch),
    );
    if (!handled) {
      const tr = view.state.tr.insertText(ch, from, to);
      view.dispatch(tr);
    }
  }
}

describe("GSD-81 — WikiLink Suggestion `[[` mounts picker", () => {
  it("typing `[[` fires render().onStart with the editor focused", async () => {
    const onStart = vi.fn();
    const onUpdate = vi.fn();
    const suggestion: WikiLinkSuggestion = {
      items: () => [],
      render: () => ({
        onStart,
        onUpdate,
        onExit: () => {},
        onKeyDown: () => false,
      }),
      command: () => {},
    };
    const editor = new Editor({
      extensions: editorExtensions({ wikiLinkSuggestion: suggestion }),
    });
    editor.commands.focus();
    typeText(editor, "[[");
    await new Promise((r) => setTimeout(r, 0));
    expect(onStart).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it("typing `[[hello` fires onStart then onUpdate with the typed query", async () => {
    const onStart = vi.fn();
    const onUpdate = vi.fn();
    const suggestion: WikiLinkSuggestion = {
      items: () => [],
      render: () => ({
        onStart,
        onUpdate,
        onExit: () => {},
        onKeyDown: () => false,
      }),
      command: () => {},
    };
    const editor = new Editor({
      extensions: editorExtensions({ wikiLinkSuggestion: suggestion }),
    });
    editor.commands.focus();
    typeText(editor, "[[hello");
    await new Promise((r) => setTimeout(r, 0));
    expect(onStart).toHaveBeenCalledTimes(1);
    // onUpdate fires once per character past the trigger.
    expect(onUpdate).toHaveBeenCalled();
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(lastCall.query).toBe("hello");
    editor.destroy();
  });
});
