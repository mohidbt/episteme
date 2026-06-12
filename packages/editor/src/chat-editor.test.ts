// GSD-105 (R6 of GSD-96) — RED. Chat editor stack + serializer.
//
// Edge case enumeration (§12):
//   - canonical:  plain text → plain string out
//   - canonical:  text + wikiLink + text → text + [lib: ...] + text (ORDER preserved)
//   - canonical:  two wikiLinks interleaved with text
//   - boundary:   wikiLink at the start of the doc
//   - boundary:   wikiLink at the end of the doc
//   - boundary:   HardBreak between text segments → `\n`
//   - empty:      empty doc → empty string + isChatDocEmpty=true
//   - empty:      whitespace-only doc → isChatDocEmpty=true
//   - non-empty:  doc with only a wikiLink (no text) → isChatDocEmpty=false
//   - suggestion: typing `@` fires render().onStart (picker reachable)
// Omissions:
//   - Image paste: deferred to GSD-106.
//   - Citation/TagMark: not part of the chat composer stack.
import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import {
  chatEditorExtensions,
  serializeChatDoc,
  isChatDocEmpty,
  type ChatWikiLinkSuggestion,
} from "./chat-editor";

function formatLibToken(h: { kind: string; id: string; title: string }): string {
  return `[lib: kind=${h.kind} id=${h.id} title="${h.title}"]`;
}

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

describe("chat-editor — serializeChatDoc", () => {
  it("plain text → plain string", () => {
    const editor = new Editor({ extensions: chatEditorExtensions() });
    editor.commands.setContent("<p>hello world</p>");
    const out = serializeChatDoc(editor.state.doc, formatLibToken);
    expect(out).toBe("hello world");
    editor.destroy();
  });

  it("text + wikiLink + text → tokens interleaved in ORDER", () => {
    const editor = new Editor({ extensions: chatEditorExtensions() });
    editor.commands.insertContent("hello ");
    editor.commands.insertContent({
      type: "wikiLink",
      attrs: {
        title: "Title",
        alias: null,
        targetKind: "paper",
        targetId: "uuid-1",
        displayTitle: null,
      },
    });
    editor.commands.insertContent(" world");
    const out = serializeChatDoc(editor.state.doc, formatLibToken);
    expect(out).toBe('hello [lib: kind=paper id=uuid-1 title="Title"] world');
    editor.destroy();
  });

  it("multiple wikiLinks interleaved → order preserved", () => {
    const editor = new Editor({ extensions: chatEditorExtensions() });
    editor.commands.insertContent("compare ");
    editor.commands.insertContent({
      type: "wikiLink",
      attrs: { title: "A", alias: null, targetKind: "paper", targetId: "id-a", displayTitle: null },
    });
    editor.commands.insertContent(" and ");
    editor.commands.insertContent({
      type: "wikiLink",
      attrs: { title: "B", alias: null, targetKind: "note", targetId: "id-b", displayTitle: null },
    });
    editor.commands.insertContent(" please");
    const out = serializeChatDoc(editor.state.doc, formatLibToken);
    expect(out).toBe(
      'compare [lib: kind=paper id=id-a title="A"] and [lib: kind=note id=id-b title="B"] please',
    );
    editor.destroy();
  });

  it("wikiLink at start of doc", () => {
    const editor = new Editor({ extensions: chatEditorExtensions() });
    editor.commands.insertContent({
      type: "wikiLink",
      attrs: { title: "T", alias: null, targetKind: "paper", targetId: "x", displayTitle: null },
    });
    editor.commands.insertContent(" tail");
    const out = serializeChatDoc(editor.state.doc, formatLibToken);
    expect(out).toBe('[lib: kind=paper id=x title="T"] tail');
    editor.destroy();
  });

  it("wikiLink at end of doc", () => {
    const editor = new Editor({ extensions: chatEditorExtensions() });
    editor.commands.insertContent("head ");
    editor.commands.insertContent({
      type: "wikiLink",
      attrs: { title: "T", alias: null, targetKind: "reference", targetId: "y", displayTitle: null },
    });
    const out = serializeChatDoc(editor.state.doc, formatLibToken);
    expect(out).toBe('head [lib: kind=reference id=y title="T"]');
    editor.destroy();
  });

  it("HardBreak between text segments → `\\n`", () => {
    const editor = new Editor({ extensions: chatEditorExtensions() });
    editor.commands.insertContent("line1");
    editor.commands.setHardBreak();
    editor.commands.insertContent("line2");
    const out = serializeChatDoc(editor.state.doc, formatLibToken);
    expect(out).toBe("line1\nline2");
    editor.destroy();
  });
});

describe("chat-editor — isChatDocEmpty", () => {
  it("empty doc → true", () => {
    const editor = new Editor({ extensions: chatEditorExtensions() });
    expect(isChatDocEmpty(editor.state.doc)).toBe(true);
    editor.destroy();
  });

  it("whitespace-only → true", () => {
    const editor = new Editor({ extensions: chatEditorExtensions() });
    editor.commands.insertContent("   ");
    expect(isChatDocEmpty(editor.state.doc)).toBe(true);
    editor.destroy();
  });

  it("text content → false", () => {
    const editor = new Editor({ extensions: chatEditorExtensions() });
    editor.commands.insertContent("hi");
    expect(isChatDocEmpty(editor.state.doc)).toBe(false);
    editor.destroy();
  });

  it("only a wikiLink, no text → false (chip alone counts as content)", () => {
    const editor = new Editor({ extensions: chatEditorExtensions() });
    editor.commands.insertContent({
      type: "wikiLink",
      attrs: { title: "T", alias: null, targetKind: "paper", targetId: "x", displayTitle: null },
    });
    expect(isChatDocEmpty(editor.state.doc)).toBe(false);
    editor.destroy();
  });
});

describe("chat-editor — `@` suggestion", () => {
  it("typing `@` fires render().onStart (picker reachable)", async () => {
    const onStart = vi.fn();
    const suggestion: ChatWikiLinkSuggestion = {
      items: () => [],
      render: () => ({
        onStart,
        onUpdate: () => {},
        onExit: () => {},
        onKeyDown: () => false,
      }),
      command: () => {},
    };
    const editor = new Editor({
      extensions: chatEditorExtensions({ wikiLinkSuggestion: suggestion }),
    });
    editor.commands.focus();
    typeText(editor, "@");
    await new Promise((r) => setTimeout(r, 0));
    expect(onStart).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it("typing `@foo` propagates the query to onUpdate", async () => {
    const onUpdate = vi.fn();
    const suggestion: ChatWikiLinkSuggestion = {
      items: () => [],
      render: () => ({
        onStart: () => {},
        onUpdate,
        onExit: () => {},
        onKeyDown: () => false,
      }),
      command: () => {},
    };
    const editor = new Editor({
      extensions: chatEditorExtensions({ wikiLinkSuggestion: suggestion }),
    });
    editor.commands.focus();
    typeText(editor, "@foo");
    await new Promise((r) => setTimeout(r, 0));
    const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(last.query).toBe("foo");
    editor.destroy();
  });
});
