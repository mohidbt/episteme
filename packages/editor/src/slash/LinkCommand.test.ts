import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { createExtensions, WikiLink } from "@episteme/markdown";
import { insertWikiLink } from "./LinkCommand";
import type { JSONContent } from "@tiptap/core";

function makeEditor() {
  return new Editor({
    extensions: [...createExtensions(), WikiLink],
    content: {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
  });
}

function findWikiLinkNode(doc: JSONContent): JSONContent | undefined {
  for (const block of doc.content ?? []) {
    const found = (block.content ?? []).find((n: JSONContent) => n.type === "wikiLink");
    if (found) return found;
  }
  return undefined;
}

describe("insertWikiLink", () => {
  it("inserts a wikiLink node at cursor with expected attrs (note)", () => {
    const editor = makeEditor();
    insertWikiLink(editor, {
      title: "Foo Note",
      targetKind: "note",
      targetId: "note-abc",
    });
    const doc = editor.getJSON();
    editor.destroy();
    const node = findWikiLinkNode(doc);
    expect(node).toBeTruthy();
    expect(node?.attrs?.title).toBe("Foo Note");
    expect(node?.attrs?.alias).toBeNull();
    expect(node?.attrs?.targetKind).toBe("note");
    expect(node?.attrs?.targetId).toBe("note-abc");
  });

  it("inserts a wikiLink with reference targetKind (prefixed with @)", () => {
    const editor = makeEditor();
    insertWikiLink(editor, {
      title: "My Ref",
      targetKind: "reference",
      targetId: "ref-xyz",
    });
    const doc = editor.getJSON();
    editor.destroy();
    const node = findWikiLinkNode(doc);
    expect(node).toBeTruthy();
    expect(node?.attrs?.title).toBe("@My Ref");
    expect(node?.attrs?.targetKind).toBe("reference");
  });

  it("inserts a wikiLink with paper targetKind (prefixed with pdf:)", () => {
    const editor = makeEditor();
    insertWikiLink(editor, {
      title: "Great Paper",
      targetKind: "paper",
      targetId: "paper-99",
    });
    const doc = editor.getJSON();
    editor.destroy();
    const node = findWikiLinkNode(doc);
    expect(node).toBeTruthy();
    expect(node?.attrs?.title).toBe("pdf:Great Paper");
    expect(node?.attrs?.targetKind).toBe("paper");
  });
});
