import { Node, mergeAttributes } from "@tiptap/core";
import type { MdLike } from "./markdown-it-types";

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
        // Inline markdown-it rule for `[[Title]]` / `[[Title|Alias]]`. The
        // renderer emits the same `span[data-type="wiki-link"]` HTML that
        // parseHTML above matches, so tiptap-markdown's pipeline
        // (setContent(md) -> md.render -> parseHTML) converts the token back
        // into a wikiLink node. Because this is emitted via our custom token
        // type (not markdown-it's html_inline), Markdown.configure({ html:
        // false }) does NOT filter it.
        parse: {
          setup(md: MdLike) {
            const TOKEN = "wiki_link";
            md.inline.ruler.after("emphasis", TOKEN, (state, silent) => {
              if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false;
              if (state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;
              const start = state.pos + 2;
              let end = start;
              while (end < state.posMax) {
                const c = state.src.charCodeAt(end);
                if (c === 0x0a /* \n */) return false;
                if (
                  c === 0x5d /* ] */ &&
                  state.src.charCodeAt(end + 1) === 0x5d
                )
                  break;
                end += 1;
              }
              if (end >= state.posMax) return false;
              const raw = state.src.slice(start, end);
              if (raw.length === 0 || raw.includes("[[")) return false;
              const pipeIdx = raw.indexOf("|");
              const title = (pipeIdx === -1 ? raw : raw.slice(0, pipeIdx)).trim();
              const alias =
                pipeIdx === -1 ? null : raw.slice(pipeIdx + 1).trim() || null;
              if (!title) return false;
              if (silent) return true;
              const token = state.push(TOKEN, "", 0);
              token.meta = { title, alias };
              state.pos = end + 2;
              return true;
            });
            md.renderer.rules[TOKEN] = (tokens, idx) => {
              const meta = tokens[idx].meta as {
                title: string;
                alias: string | null;
              };
              const label = meta.alias ?? meta.title;
              const titleAttr = md.utils.escapeHtml(meta.title);
              const aliasAttr = meta.alias
                ? ` data-alias="${md.utils.escapeHtml(meta.alias)}"`
                : "";
              return `<span data-type="wiki-link" data-title="${titleAttr}"${aliasAttr} data-resolved="false">${md.utils.escapeHtml(label)}</span>`;
            };
          },
        },
      },
    };
  },
});
