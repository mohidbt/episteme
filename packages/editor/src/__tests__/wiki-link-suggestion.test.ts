/**
 * GSD-96 R3-A: `editorExtensions` must accept an optional `triggerChar` for the
 * WikiLink Suggestion plugin, default `"[["`. Round B (Tiptap-in-ChatComposer)
 * will reuse the same extension stack with `triggerChar: "@"` to drive an
 * @-mention picker. Round A = mechanical config-surface change only.
 *
 * Edge cases:
 *   - Default (unspecified) MUST behave exactly like `"[["` — existing
 *     NoteEditor (apps/km/.../NoteEditor.tsx:372) is a literal regression
 *     surface; it never sets triggerChar.
 *   - Custom char (`"@"`) MUST fire `onStart` on typing `@` and MUST NOT fire
 *     on typing `[[`.
 *   - `wikiLinkSuggestion` not supplied → triggerChar option is irrelevant
 *     (no suggestion plugin mounted). Not exercised here; covered by
 *     wiki-suggestion-mount.test.ts (default-trigger negative path).
 *   - Multi-char triggers (`"[["`) must continue to work — Tiptap's Suggestion
 *     supports multi-char `char`. Default case proves this.
 */
import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions, type WikiLinkSuggestion } from "../extensions";

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

function makeSuggestion(onStart: ReturnType<typeof vi.fn>): WikiLinkSuggestion {
  return {
    items: () => [],
    render: () => ({
      // vi.fn() types as Mock<Procedure | Constructable>, not a plain
      // (props) => void; cast at the boundary so the mock stays assertable.
      onStart: onStart as unknown as () => void,
      onUpdate: () => {},
      onExit: () => {},
      onKeyDown: () => false,
    }),
    command: () => {},
  };
}

describe("GSD-96 R3-A — wikiLinkSuggestion accepts triggerChar option", () => {
  it("defaults to `[[` when triggerChar is omitted", async () => {
    const onStart = vi.fn();
    const editor = new Editor({
      extensions: editorExtensions({ wikiLinkSuggestion: makeSuggestion(onStart) }),
    });
    editor.commands.focus();
    typeText(editor, "[[");
    await new Promise((r) => setTimeout(r, 0));
    expect(onStart).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it("uses the supplied triggerChar (`@`) — fires on `@`", async () => {
    const onStart = vi.fn();
    const editor = new Editor({
      extensions: editorExtensions({
        wikiLinkSuggestion: makeSuggestion(onStart),
        wikiLinkTriggerChar: "@",
      }),
    });
    editor.commands.focus();
    typeText(editor, "@");
    await new Promise((r) => setTimeout(r, 0));
    expect(onStart).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it("supplied triggerChar (`@`) does NOT fire on the default `[[`", async () => {
    const onStart = vi.fn();
    const editor = new Editor({
      extensions: editorExtensions({
        wikiLinkSuggestion: makeSuggestion(onStart),
        wikiLinkTriggerChar: "@",
      }),
    });
    editor.commands.focus();
    typeText(editor, "[[");
    await new Promise((r) => setTimeout(r, 0));
    expect(onStart).not.toHaveBeenCalled();
    editor.destroy();
  });
});
