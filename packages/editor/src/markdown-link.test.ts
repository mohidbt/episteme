import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
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

function simulatePaste(editor: Editor, plain: string): boolean {
  const handlePaste = editor.view.someProp("handlePaste") as
    | ((view: unknown, event: Event, slice: unknown) => boolean)
    | undefined;
  if (!handlePaste) return false;
  const clipboardData = {
    getData: (type: string) => (type === "text/plain" ? plain : ""),
    types: ["text/plain"],
  };
  const event = Object.assign(new Event("paste"), { clipboardData });
  return handlePaste(editor.view, event, null);
}

describe("D6 markdown link behaviours", () => {
  it("typing `[hello](https://example.com) ` produces a link mark", () => {
    const editor = makeEditor();
    // Insert through the view so input rules run.
    editor.commands.insertContent("[hello](https://example.com)");
    // Trigger the input rule by typing a trailing space via an explicit
    // textInput transaction (input rules are applied on text input).
    const { state, dispatch } = editor.view;
    const tr = state.tr.insertText(" ", state.selection.from);
    dispatch(tr);

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
