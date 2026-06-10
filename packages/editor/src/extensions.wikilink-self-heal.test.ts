/**
 * Regression: extending WikiLink with a Suggestion plugin in
 * `editorExtensions` must NOT clobber the base self-heal plugin defined in
 * `@episteme/markdown`'s WikiLink. Without `this.parent?.()`, the override
 * silently drops the self-heal plugin and legacy YJS-hydrated wikiLink nodes
 * with raw prefixes (`pdf:foo`, `@bib`, `p:foo`, `r:bar`) and `targetKind=null`
 * never get healed in the KM editor build.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions, type WikiLinkSuggestion } from "./extensions";

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

describe("WikiLink self-heal plugin survives Suggestion extension", () => {
  it("editor.state.plugins includes the wikiLinkSelfHeal plugin", () => {
    const editor = new Editor({
      extensions: editorExtensions({ wikiLinkSuggestion: noopSuggestion }),
    });

    const keys = editor.state.plugins
      .map((p) => {
        // PluginKey stores the key on `.key` (private but stable across pm versions).
        const k = (p as unknown as { key?: string }).key;
        return typeof k === "string" ? k : "";
      })
      .filter(Boolean);

    const hasSelfHeal = keys.some((k) => k.includes("wikiLinkSelfHeal"));
    expect(hasSelfHeal).toBe(true);

    editor.destroy();
  });

  it("heals a legacy YJS-style wikiLink (title='pdf:foo', targetKind=null) into kind='paper'", () => {
    const editor = new Editor({
      extensions: editorExtensions({ wikiLinkSuggestion: noopSuggestion }),
    });

    // Seed doc directly with a node mirroring a legacy YJS-hydrated wikiLink:
    // raw prefix in title, null kind. Bypass markdown-it (which is the bug
    // surface — YJS hydration skips it).
    const { schema } = editor.state;
    const wikiLinkType = schema.nodes.wikiLink;
    expect(wikiLinkType).toBeDefined();

    const node = wikiLinkType.create({
      title: "pdf:foo",
      alias: null,
      targetKind: null,
      targetId: null,
      displayTitle: null,
    });
    const para = schema.nodes.paragraph.create(null, node);
    const doc = schema.nodes.doc.create(null, para);
    const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content);
    editor.view.dispatch(tr);

    // Trigger an empty transaction so appendTransaction runs (the view-mount
    // path also runs on first dispatch via the plugin's view() hook).
    editor.view.dispatch(editor.state.tr);

    let healed: { title: string; targetKind: string | null } | null = null;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "wikiLink") {
        healed = {
          title: n.attrs.title as string,
          targetKind: n.attrs.targetKind as string | null,
        };
      }
    });

    expect(healed).toEqual({ title: "foo", targetKind: "paper" });

    editor.destroy();
  });
});
