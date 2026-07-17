import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { Slice, Fragment } from "@tiptap/pm/model";
import { editorExtensions } from "./extensions";

/**
 * Bug D6: NoteEditor must convert markdown link syntax + autolink pasted URLs.
 *
 * Three behaviours under test:
 *   1) Typing `[text](url)` then space triggers an input rule that produces a
 *      link mark with the given href.
 *   2) Pasting a bare URL into an empty selection produces a link mark.
 *   3) Pasting a bare URL while text is selected wraps the selection in a
 *      link mark to that URL.
 */
function makeEditor() {
  return new Editor({
    extensions: editorExtensions(),
  });
}

interface MarkJSON {
  type: string;
  attrs?: Record<string, unknown>;
}
interface NodeJSON {
  type: string;
  text?: string;
  marks?: MarkJSON[];
  content?: NodeJSON[];
}

function findLinkMark(editor: Editor): { text: string; href: string } | null {
  const json = editor.getJSON() as { content?: NodeJSON[] };
  const walk = (nodes?: NodeJSON[]): { text: string; href: string } | null => {
    if (!nodes) return null;
    for (const n of nodes) {
      const link = n.marks?.find((m) => m.type === "link");
      if (link && typeof n.text === "string") {
        return { text: n.text, href: String(link.attrs?.href ?? "") };
      }
      const child = walk(n.content);
      if (child) return child;
    }
    return null;
  };
  return walk(json.content);
}

function simulatePaste(editor: Editor, plain: string): void {
  const view = editor.view;
  const { schema } = view.state;

  // First give registered `handlePaste` handlers (e.g. Link's linkOnPaste,
  // MdPaste) a chance — same way ProseMirror would.
  const text = schema.text(plain);
  const para = schema.nodes.paragraph.create(null, text);
  const slice = new Slice(Fragment.from(para), 1, 1);

  const clipboardData = {
    getData: (type: string) => (type === "text/plain" ? plain : ""),
    types: ["text/plain"],
  };
  const event = Object.assign(new Event("paste"), { clipboardData });

  const handled = view.someProp("handlePaste", (handler) =>
    handler(view, event as unknown as ClipboardEvent, slice),
  );

  // No handler claimed the paste → fall through to ProseMirror's default,
  // which is to replaceSelectionWith the slice and tag the transaction with
  // uiEvent='paste'. The `pasteRulesPlugin` watches that meta to apply
  // markPasteRule (Link's bare-URL autolink). We replicate that here.
  if (!handled) {
    const tr = view.state.tr.replaceSelection(slice);
    tr.setMeta("uiEvent", "paste");
    view.dispatch(tr);
  }
}

describe("D6 markdown link behaviours", () => {
  it("typing `[hello](https://example.com) ` produces a link mark", () => {
    const editor = makeEditor();
    // Simulate true typing: each char enters through ProseMirror's textInput
    // path, which is what triggers input rules. View.someProp("handleTextInput")
    // dispatches the inputRulesPlugin handler.
    const text = "[hello](https://example.com) ";
    for (const ch of text) {
      const view = editor.view;
      const { from, to } = view.state.selection;
      const handled = view.someProp("handleTextInput", (h) =>
        (h as (...a: unknown[]) => boolean)(view, from, to, ch),
      );
      if (!handled) {
        const tr = view.state.tr.insertText(ch, from, to);
        view.dispatch(tr);
      }
    }

    const link = findLinkMark(editor);
    expect(link).not.toBeNull();
    expect(link?.text).toBe("hello");
    expect(link?.href).toBe("https://example.com");
    editor.destroy();
  });

  it("paste of a bare URL into empty selection produces a link mark", () => {
    const editor = makeEditor();
    simulatePaste(editor, "https://example.com");
    const link = findLinkMark(editor);
    expect(link).not.toBeNull();
    expect(link?.href).toBe("https://example.com");
    editor.destroy();
  });

  it("paste of a URL with text selected wraps the selection in a link", () => {
    const editor = makeEditor();
    editor.commands.insertContent("click here");
    // Select the inserted text. After insertContent the selection sits at the
    // end; select all to wrap "click here".
    editor.commands.selectAll();
    simulatePaste(editor, "https://example.com");
    const link = findLinkMark(editor);
    expect(link).not.toBeNull();
    expect(link?.text).toContain("click here");
    expect(link?.href).toBe("https://example.com");
    editor.destroy();
  });
});
