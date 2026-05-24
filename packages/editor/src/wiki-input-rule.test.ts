/**
 * K6 regression: typing `[[p:Foo]]` in the *real* editor extension stack
 * (with the Suggestion plugin attached via `editorExtensions`) must produce
 * a wikiLink node with `targetKind="paper"`.
 *
 * The standalone WikiLink.test.ts covers the InputRule in isolation. This
 * test pins down the integration where prod actually broke: when WikiLink
 * is `.extend()`-ed with a Suggestion ProseMirror plugin (the `[[`
 * typeahead), the InputRule must still fire and propagate targetKind.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions, type WikiLinkSuggestion } from "./extensions";

// Minimal Suggestion config — does nothing UI-wise, just attaches a
// `[[` Suggestion ProseMirror plugin so the WikiLink.extend() branch runs.
const noopSuggestion: WikiLinkSuggestion = {
  items: () => [],
  render: () => ({
    onStart: () => {},
    onUpdate: () => {},
    onExit: () => {},
    onKeyDown: () => false,
  }),
  command: () => {},
};

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

describe("WikiLink InputRule with Suggestion plugin attached (K6 prod repro)", () => {
  it("typing `[[p:Test Paper]]` → kind=paper, title=Test Paper", () => {
    const editor = new Editor({
      extensions: editorExtensions({ wikiLinkSuggestion: noopSuggestion }),
    });
    typeText(editor, "[[p:Test Paper]]");
    const html = editor.getHTML();
    expect(html).toContain('data-title="Test Paper"');
    expect(html).toContain('data-target-kind="paper"');
    expect(html).toContain("<svg");
    editor.destroy();
  });

  it("typing `[[r:Ref]]` → kind=reference, title=Ref", () => {
    const editor = new Editor({
      extensions: editorExtensions({ wikiLinkSuggestion: noopSuggestion }),
    });
    typeText(editor, "[[r:Ref]]");
    const html = editor.getHTML();
    expect(html).toContain('data-target-kind="reference"');
    expect(html).toContain('data-title="Ref"');
    editor.destroy();
  });
});
