import { Node, mergeAttributes } from "@tiptap/core";

export type WikiLinkTargetKind = "note" | "reference" | "paper" | null;

export interface WikiLinkAttrs {
  title: string;
  alias: string | null;
  targetKind: WikiLinkTargetKind;
  targetId: string | null;
}

// Pill class — static; resolved/unresolved styling is driven by the
// `data-resolved` attribute via CSS in packages/editor/src/styles.css
// (Tailwind v4 doesn't scan workspace package sources by default).
const PILL_CLASS = "wiki-link";

// Inline atom node: a `[[Title]]` pill. The text the user sees is the alias
// (if any) or the title; attrs are preserved for round-tripping and for the
// backlinks/resolver layer. Markdown serialization emits the literal
// `[[Title]]` / `[[Title|Alias]]` form; parsing `[[..]]` back into nodes is
// not done by the editor — rebuildLinks reads the saved markdown directly.
export const WikiLink = Node.create({
  name: "wikiLink",
  inline: true,
  atom: true,
  group: "inline",
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      title: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-title") ?? "",
        renderHTML: (attrs) => ({ "data-title": attrs.title }),
      },
      alias: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-alias"),
        renderHTML: (attrs) =>
          attrs.alias ? { "data-alias": attrs.alias } : {},
      },
      targetKind: {
        default: null as WikiLinkTargetKind,
        parseHTML: (el) =>
          (el.getAttribute("data-target-kind") as WikiLinkTargetKind) ?? null,
        renderHTML: (attrs) =>
          attrs.targetKind ? { "data-target-kind": attrs.targetKind } : {},
      },
      targetId: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute("data-target-id"),
        renderHTML: (attrs) =>
          attrs.targetId ? { "data-target-id": attrs.targetId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="wiki-link"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as WikiLinkAttrs;
    const resolved = attrs.targetId != null;
    const label = attrs.alias ?? attrs.title;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "wiki-link",
        "data-resolved": resolved ? "true" : "false",
        class: PILL_CLASS,
      }),
      label,
    ];
  },

  addStorage() {
    return {
      markdown: {
        // tiptap-markdown reads `storage.markdown.serialize` per-extension and
        // invokes this for each node of our type. We write the raw `[[..]]`
        // token; nothing else needs escaping.
        serialize(
          state: { write: (s: string) => void },
          node: { attrs: WikiLinkAttrs },
        ) {
          const { title, alias } = node.attrs;
          state.write(alias ? `[[${title}|${alias}]]` : `[[${title}]]`);
        },
        parse: {},
      },
    };
  },
});
