import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { createExtensions, WikiLink, TagMark } from "@episteme/markdown";
import { hydrateWikiLinkResolutions } from "./hydrate-wiki-links";

function makeEditor() {
  const editor = new Editor({
    extensions: [...createExtensions(), WikiLink, TagMark],
  });
  return editor;
}

type Child = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Child[];
};

function findWikiByTitle(editor: Editor, title: string): Child | undefined {
  const json = editor.getJSON();
  const walk = (nodes: Child[] | undefined): Child | undefined => {
    if (!nodes) return undefined;
    for (const n of nodes) {
      if (n.type === "wikiLink" && n.attrs?.title === title) return n;
      const hit = walk(n.content);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(json.content as Child[] | undefined);
}

describe("hydrateWikiLinkResolutions", () => {
  it("fills in targetKind/targetId for matched titles and leaves unmatched alone", () => {
    const editor = makeEditor();
    editor.commands.setContent("pre [[Foo]] mid [[Bar]] post");

    const result = hydrateWikiLinkResolutions(editor, {
      foo: { targetKind: "note", targetId: "abc" },
    });

    expect(result).toBe(true);

    const foo = findWikiByTitle(editor, "Foo");
    expect(foo).toBeDefined();
    expect(foo?.attrs?.targetKind).toBe("note");
    expect(foo?.attrs?.targetId).toBe("abc");

    const bar = findWikiByTitle(editor, "Bar");
    expect(bar).toBeDefined();
    expect(bar?.attrs?.targetId ?? null).toBe(null);

    editor.destroy();
  });

  it("returns false and modifies nothing when given an empty map", () => {
    const editor = makeEditor();
    editor.commands.setContent("see [[Foo]] today");

    const before = editor.getJSON();
    const result = hydrateWikiLinkResolutions(editor, {});

    expect(result).toBe(false);
    expect(editor.getJSON()).toEqual(before);

    editor.destroy();
  });

  it("K6: kind-qualified lookup — paper `[[p:Foo]]` matches `paper::foo` not `note::foo`", () => {
    const editor = makeEditor();
    // [[p:Foo]] ingress → title="Foo", targetKind="paper"
    editor.commands.setContent("see [[p:Foo]] x");

    const result = hydrateWikiLinkResolutions(editor, {
      // Note with same stripped title — must NOT match the paper pill.
      "note::foo": { targetKind: "note", targetId: "wrong-note" },
      "paper::foo": { targetKind: "paper", targetId: "right-paper" },
    });

    expect(result).toBe(true);
    const foo = findWikiByTitle(editor, "Foo");
    expect(foo?.attrs?.targetKind).toBe("paper");
    expect(foo?.attrs?.targetId).toBe("right-paper");
    editor.destroy();
  });

  it("matches titles case-insensitively (title [[FOO]] matches key `foo`)", () => {
    const editor = makeEditor();
    editor.commands.setContent("hello [[FOO]] world");

    const result = hydrateWikiLinkResolutions(editor, {
      foo: { targetKind: "reference", targetId: "ref-1" },
    });

    expect(result).toBe(true);
    const node = findWikiByTitle(editor, "FOO");
    expect(node?.attrs?.targetKind).toBe("reference");
    expect(node?.attrs?.targetId).toBe("ref-1");

    editor.destroy();
  });
});
