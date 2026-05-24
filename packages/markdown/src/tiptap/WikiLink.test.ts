import { describe, expect, it } from "vitest";
import { Editor, generateJSON, type Content, type JSONContent } from "@tiptap/core";
import { createExtensions } from "../extensions";
import { WikiLink, classifyWikiTarget, type WikiLinkTargetKind } from "./WikiLink";

// Build a Tiptap editor that has the WikiLink node + tiptap-markdown.
function makeEditor(content: Content) {
  return new Editor({
    extensions: [...createExtensions(), WikiLink],
    content,
  });
}

function toMd(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown: () => string } };
  return storage.markdown?.getMarkdown() ?? "";
}

// Parse markdown → JSONContent using the extension set that includes WikiLink,
// so WikiLink's parse.setup hook registers its markdown-it inline rule. The
// top-level mdToProseMirror helper omits WikiLink by design; this local variant
// is what exercises the parse path under test.
function mdToJSON(md: string): JSONContent {
  const editor = new Editor({
    extensions: [...createExtensions(), WikiLink],
  });
  editor.commands.setContent(md);
  const json = editor.getJSON();
  editor.destroy();
  return json;
}

describe("WikiLink tiptap node", () => {
  it("serializes a wikiLink node to `[[Title]]` markdown", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            {
              type: "wikiLink",
              attrs: { title: "Transformers", alias: null, targetKind: "note", targetId: null },
            },
          ],
        },
      ],
    });
    const md = toMd(editor);
    expect(md).toContain("[[Transformers]]");
    editor.destroy();
  });

  it("serializes an aliased wikiLink to `[[Title|alias]]`", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "wikiLink",
              attrs: { title: "Transformers", alias: "TF", targetKind: "note", targetId: null },
            },
          ],
        },
      ],
    });
    expect(toMd(editor)).toContain("[[Transformers|TF]]");
    editor.destroy();
  });

  it("renders a pill span with data attrs for parseHTML round-trip", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "wikiLink",
              attrs: { title: "Note A", alias: null, targetKind: "note", targetId: "abc" },
            },
          ],
        },
      ],
    });
    const html = editor.getHTML();
    expect(html).toContain('data-type="wiki-link"');
    expect(html).toContain('data-title="Note A"');
    expect(html).toContain('data-target-id="abc"');
    expect(html).toContain('data-resolved="true"');
    editor.destroy();
  });

  it("renders an inline svg icon for paper targetKind", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "wikiLink",
              attrs: { title: "crispr-paper.pdf", alias: null, targetKind: "paper", targetId: null },
            },
          ],
        },
      ],
    });
    const html = editor.getHTML();
    expect(html).toContain('data-target-kind="paper"');
    expect(html).toContain("<svg");
    expect(html).toContain("wiki-link--paper");
    editor.destroy();
  });

  it("renders an inline svg icon for reference targetKind", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "wikiLink",
              attrs: { title: "vaswani2017", alias: null, targetKind: "reference", targetId: null },
            },
          ],
        },
      ],
    });
    const html = editor.getHTML();
    expect(html).toContain('data-target-kind="reference"');
    expect(html).toContain("<svg");
    expect(html).toContain("wiki-link--reference");
    editor.destroy();
  });

  it("does not render svg icon for note targetKind", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "wikiLink",
              attrs: { title: "Note A", alias: null, targetKind: "note", targetId: null },
            },
          ],
        },
      ],
    });
    const html = editor.getHTML();
    expect(html).not.toContain("<svg");
    editor.destroy();
  });

  it("renders data-resolved=false when targetId is null", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "wikiLink",
              attrs: { title: "Missing", alias: null, targetKind: "note", targetId: null },
            },
          ],
        },
      ],
    });
    expect(editor.getHTML()).toContain('data-resolved="false"');
    editor.destroy();
  });

  it("parses HTML pill back into a wikiLink node", () => {
    // generateJSON takes raw HTML through Tiptap's HTML parser (not
    // tiptap-markdown's setContent override which treats strings as markdown).
    const json = generateJSON(
      '<p><span data-type="wiki-link" data-title="Alpha" data-alias="A" data-target-kind="note" data-target-id="123" data-resolved="true">Alpha</span></p>',
      [...createExtensions(), WikiLink],
    );
    const para = (json.content ?? [])[0] as { content?: unknown[] };
    const node = (para.content ?? [])[0] as {
      type: string;
      attrs: Record<string, unknown>;
    };
    expect(node.type).toBe("wikiLink");
    expect(node.attrs.title).toBe("Alpha");
    expect(node.attrs.alias).toBe("A");
    expect(node.attrs.targetKind).toBe("note");
    expect(node.attrs.targetId).toBe("123");
  });
});

// Helpers for walking the paragraph children of a parsed doc.
type Child = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string }>; content?: Child[] };
function paragraphChildren(json: JSONContent): Child[] {
  const para = (json.content ?? [])[0] as { content?: Child[] } | undefined;
  return para?.content ?? [];
}
function findNode(json: JSONContent, type: string): Child | undefined {
  const walk = (nodes: Child[] | undefined): Child | undefined => {
    if (!nodes) return undefined;
    for (const n of nodes) {
      if (n.type === type) return n;
      const hit = walk(n.content);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(json.content as Child[] | undefined);
}

describe("WikiLink markdown parse", () => {
  it("parses [[Title]] as a wikiLink node with title attr", () => {
    const json = mdToJSON("see [[Transformers]] today");
    const children = paragraphChildren(json);
    const wiki = children.find((c) => c.type === "wikiLink");
    expect(wiki).toBeDefined();
    expect(wiki?.attrs?.title).toBe("Transformers");
    // Node default for `alias` is `null`.
    expect(wiki?.attrs?.alias ?? null).toBe(null);
    const texts = children.filter((c) => c.type === "text").map((c) => c.text ?? "");
    expect(texts.some((t) => t.includes("see "))).toBe(true);
    expect(texts.some((t) => t.includes(" today"))).toBe(true);
  });

  it("parses [[Title|Alias]] as a wikiLink node with alias attr", () => {
    const json = mdToJSON("see [[Transformers|TF]]");
    const wiki = findNode(json, "wikiLink");
    expect(wiki).toBeDefined();
    expect(wiki?.attrs?.title).toBe("Transformers");
    expect(wiki?.attrs?.alias).toBe("TF");
  });

  it("does not parse [[Title]] inside a code span", () => {
    const json = mdToJSON("use `[[Foo]]` literally");
    const children = paragraphChildren(json);
    expect(children.find((c) => c.type === "wikiLink")).toBeUndefined();
    const codeText = children.find(
      (c) => c.type === "text" && c.marks?.some((m) => m.type === "code"),
    );
    expect(codeText?.text).toBe("[[Foo]]");
  });

  it("does not parse [[Title]] inside a fenced code block", () => {
    const json = mdToJSON("```\n[[Foo]]\n```");
    expect(findNode(json, "wikiLink")).toBeUndefined();
    const codeBlock = findNode(json, "codeBlock");
    expect(codeBlock).toBeDefined();
    const inner = codeBlock?.content?.find((c) => c.type === "text");
    expect(inner?.text).toBe("[[Foo]]");
  });

  // K6 prod regression: typing `[[p:Foo]]` rendered correctly on first paint
  // but reloads showed kind=note because `serialize` dropped the `p:` prefix
  // (title attr stores the STRIPPED label). The roundtrip must preserve kind.
  it("K6: serialize(parse(`[[p:Foo]]`)) === `[[p:Foo]]` (kind round-trips)", () => {
    const editor = new Editor({
      extensions: [...createExtensions(), WikiLink],
    });
    editor.commands.setContent("see [[p:Foo]] x");
    expect(toMd(editor).trim()).toBe("see [[p:Foo]] x");
    editor.destroy();
  });
  it("K6: serialize(parse(`[[r:Bar]]`)) === `[[r:Bar]]` (kind round-trips)", () => {
    const editor = new Editor({
      extensions: [...createExtensions(), WikiLink],
    });
    editor.commands.setContent("see [[r:Bar]] x");
    expect(toMd(editor).trim()).toBe("see [[r:Bar]] x");
    editor.destroy();
  });
  it("K6: legacy `[[@bib]]` round-trips through modern `[[r:bib]]` form", () => {
    // Ingress accepts legacy `@` and `pdf:`, but serialize normalizes to the
    // modern short forms. Reload of the normalized markdown still classifies
    // to `reference` / `paper`, preserving the icon.
    const editor = new Editor({
      extensions: [...createExtensions(), WikiLink],
    });
    editor.commands.setContent("see [[@bib]] x");
    expect(toMd(editor).trim()).toBe("see [[r:bib]] x");
    editor.destroy();
  });

  it("is idempotent: serialize(parse([[Title]])) === [[Title]]", () => {
    const editor = new Editor({
      extensions: [...createExtensions(), WikiLink],
    });
    editor.commands.setContent("see [[Transformers]] today");
    expect(toMd(editor).trim()).toBe("see [[Transformers]] today");
    editor.destroy();
  });
});

// K6: targetKind must be inferred from prefix at both ingress points
// (markdown-it parse + input rule). Display label must NOT include the prefix.
describe("WikiLink prefix classification (K6)", () => {
  describe("markdown-it parse path", () => {
    it("[[Name]] → kind=note, title=Name", () => {
      const wiki = findNode(mdToJSON("see [[Name]] x"), "wikiLink");
      expect(wiki?.attrs?.title).toBe("Name");
      expect(wiki?.attrs?.targetKind).toBe("note");
    });
    it("[[@bibkey]] → kind=reference, title=bibkey", () => {
      const wiki = findNode(mdToJSON("see [[@bibkey]] x"), "wikiLink");
      expect(wiki?.attrs?.title).toBe("bibkey");
      expect(wiki?.attrs?.targetKind).toBe("reference");
    });
    it("[[pdf:foo.pdf]] → kind=paper, title=foo.pdf", () => {
      const wiki = findNode(mdToJSON("see [[pdf:foo.pdf]] x"), "wikiLink");
      expect(wiki?.attrs?.title).toBe("foo.pdf");
      expect(wiki?.attrs?.targetKind).toBe("paper");
    });
    it("[[p:foo]] → kind=paper, title=foo", () => {
      const wiki = findNode(mdToJSON("see [[p:foo]] x"), "wikiLink");
      expect(wiki?.attrs?.title).toBe("foo");
      expect(wiki?.attrs?.targetKind).toBe("paper");
    });
    it("[[r:bar]] → kind=reference, title=bar", () => {
      const wiki = findNode(mdToJSON("see [[r:bar]] x"), "wikiLink");
      expect(wiki?.attrs?.title).toBe("bar");
      expect(wiki?.attrs?.targetKind).toBe("reference");
    });
    it("[[p:foo]] renders svg icon for paper", () => {
      const editor = new Editor({ extensions: [...createExtensions(), WikiLink] });
      editor.commands.setContent("see [[p:foo]]");
      const html = editor.getHTML();
      expect(html).toContain('data-target-kind="paper"');
      expect(html).toContain("<svg");
      editor.destroy();
    });
    it("[[r:bar]] renders svg icon for reference", () => {
      const editor = new Editor({ extensions: [...createExtensions(), WikiLink] });
      editor.commands.setContent("see [[r:bar]]");
      const html = editor.getHTML();
      expect(html).toContain('data-target-kind="reference"');
      expect(html).toContain("<svg");
      editor.destroy();
    });
  });

  describe("input rule (live editor — actually types text)", () => {
    // Simulate true typing through ProseMirror's `handleTextInput` so the
    // `inputRules` plugin fires. Bypasses `setContent` (which goes through
    // markdown-it) so this exclusively exercises the InputRule handler.
    function typeText(editor: Editor, text: string) {
      for (const ch of text) {
        const view = editor.view;
        const { from, to } = view.state.selection;
        const handled = view.someProp("handleTextInput", (h) =>
          // Cast — ProseMirror 1.34+ added a 5th `event` arg to
          // handleTextInput, but at runtime our 4-arg call still triggers
          // input rules in tests.
          (h as (...args: unknown[]) => boolean)(view, from, to, ch),
        );
        if (!handled) {
          const tr = view.state.tr.insertText(ch, from, to);
          view.dispatch(tr);
        }
      }
    }
    it("typing `[[p:Test]]` → kind=paper, title=Test (live InputRule)", () => {
      const editor = new Editor({
        extensions: [...createExtensions(), WikiLink],
      });
      typeText(editor, "[[p:Test]]");
      const html = editor.getHTML();
      expect(html).toContain('data-target-kind="paper"');
      expect(html).toContain('data-title="Test"');
      expect(html).toContain("<svg");
      editor.destroy();
    });
    it("typing `[[r:Ref]]` → kind=reference, title=Ref (live InputRule)", () => {
      const editor = new Editor({
        extensions: [...createExtensions(), WikiLink],
      });
      typeText(editor, "[[r:Ref]]");
      const html = editor.getHTML();
      expect(html).toContain('data-target-kind="reference"');
      expect(html).toContain('data-title="Ref"');
      expect(html).toContain("<svg");
      editor.destroy();
    });
    it("typing `[[Just Note]]` → kind=note, title=Just Note (live InputRule)", () => {
      const editor = new Editor({
        extensions: [...createExtensions(), WikiLink],
      });
      typeText(editor, "[[Just Note]]");
      const html = editor.getHTML();
      expect(html).toContain('data-title="Just Note"');
      // Note kind: no data-target-kind attribute (renderHTML omits when null)
      // AND no svg icon (none rendered for note kind).
      expect(html).not.toContain("<svg");
      editor.destroy();
    });
  });

  describe("K6 self-heal (YJS-hydrated stale nodes)", () => {
    // Helper: find the first wikiLink node in a live editor's doc.
    function findWiki(editor: Editor): { title: string; targetKind: WikiLinkTargetKind } | null {
      let found: { title: string; targetKind: WikiLinkTargetKind } | null = null;
      editor.state.doc.descendants((n) => {
        if (n.type.name === "wikiLink" && !found) {
          found = {
            title: n.attrs.title as string,
            targetKind: n.attrs.targetKind as WikiLinkTargetKind,
          };
        }
      });
      return found;
    }

    // Inject a stale ProseMirror JSON doc — title carries the prefix, kind null
    // — exactly the shape YJS hydrates when Hocuspocus replays pre-K6 state.
    // We build the editor empty then `setContent` the JSON, which dispatches
    // a transaction and exercises the self-heal `appendTransaction` hook.
    function staleDoc(title: string): JSONContent {
      return {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "wikiLink",
                attrs: { title, alias: null, targetKind: null, targetId: null },
              },
            ],
          },
        ],
      };
    }
    function staleEditor(title: string): Editor {
      const editor = new Editor({
        extensions: [...createExtensions(), WikiLink],
      });
      // setContent with a JSON object (not a markdown string) skips the
      // markdown-it parse path and writes the node attrs as-given — exactly
      // mirroring YJS hydration of pre-K6 state.
      editor.commands.setContent(staleDoc(title));
      return editor;
    }

    it("heals stale `pdf:spontaneous.pdf` → kind=paper, title=spontaneous.pdf", () => {
      const editor = staleEditor(("pdf:spontaneous.pdf"));
      const wiki = findWiki(editor);
      expect(wiki?.targetKind).toBe("paper");
      expect(wiki?.title).toBe("spontaneous.pdf");
      editor.destroy();
    });

    it("heals stale `@bibkey` → kind=reference, title=bibkey", () => {
      const editor = staleEditor(("@bibkey"));
      const wiki = findWiki(editor);
      expect(wiki?.targetKind).toBe("reference");
      expect(wiki?.title).toBe("bibkey");
      editor.destroy();
    });

    it("heals stale `p:foo` → kind=paper, title=foo", () => {
      const editor = staleEditor(("p:foo"));
      const wiki = findWiki(editor);
      expect(wiki?.targetKind).toBe("paper");
      expect(wiki?.title).toBe("foo");
      editor.destroy();
    });

    it("heals stale `r:bar` → kind=reference, title=bar", () => {
      const editor = staleEditor(("r:bar"));
      const wiki = findWiki(editor);
      expect(wiki?.targetKind).toBe("reference");
      expect(wiki?.title).toBe("bar");
      editor.destroy();
    });

    it("plain `[[Note]]` with kind=null is a no-op (renders identically)", () => {
      // No prefix → no transaction dispatched. Plain `note` renders the same
      // whether targetKind is `null` or `"note"` (renderHTML omits attrs +
      // skips icon in both cases), so heal would be transaction noise.
      const editor = staleEditor(("PlainNote"));
      const wiki = findWiki(editor);
      expect(wiki?.targetKind).toBe(null);
      expect(wiki?.title).toBe("PlainNote");
      editor.destroy();
    });

    it("already-classified `kind=paper`, clean title is NOT re-touched (no-op)", () => {
      const editor = makeEditor({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "wikiLink",
                attrs: { title: "foo.pdf", alias: null, targetKind: "paper", targetId: null },
              },
            ],
          },
        ],
      });
      const wiki = findWiki(editor);
      expect(wiki?.targetKind).toBe("paper");
      expect(wiki?.title).toBe("foo.pdf");
      editor.destroy();
    });

    it("self-heal renders the svg icon for healed paper nodes", () => {
      const editor = staleEditor(("pdf:spontaneous.pdf"));
      const html = editor.getHTML();
      expect(html).toContain('data-target-kind="paper"');
      expect(html).toContain("<svg");
      expect(html).toContain('data-title="spontaneous.pdf"');
      editor.destroy();
    });
  });

  describe("input rule classifier (used by InputRule handler)", () => {
    // The input rule shares the same prefix classifier as the markdown-it
    // parse path. Test the classifier directly — this is what the rule
    // handler calls to set attrs.targetKind on the new wikiLink node.
    it("[[Name]] → kind=note, title=Name", () => {
      expect(classifyWikiTarget("Name")).toEqual({ kind: "note", title: "Name" });
    });
    it("[[@bibkey]] → kind=reference, title=bibkey", () => {
      expect(classifyWikiTarget("@bibkey")).toEqual({ kind: "reference", title: "bibkey" });
    });
    it("[[pdf:foo.pdf]] → kind=paper, title=foo.pdf", () => {
      expect(classifyWikiTarget("pdf:foo.pdf")).toEqual({ kind: "paper", title: "foo.pdf" });
    });
    it("[[p:foo]] → kind=paper, title=foo", () => {
      expect(classifyWikiTarget("p:foo")).toEqual({ kind: "paper", title: "foo" });
    });
    it("[[r:bar]] → kind=reference, title=bar", () => {
      expect(classifyWikiTarget("r:bar")).toEqual({ kind: "reference", title: "bar" });
    });
  });
});
