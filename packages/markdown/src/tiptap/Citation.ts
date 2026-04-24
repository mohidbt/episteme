import { Node, mergeAttributes } from "@tiptap/core";
import type { MdLike } from "./markdown-it-types";

export interface CitationAttrs {
  citekey: string;
  title: string | null;
  authors: string[] | null;
  year: string | null;
}

/**
 * Inline atom node storing citation data. Renders as [n] superscript.
 * MD serializes to [@citekey] (Pandoc-style).
 */
export const Citation = Node.create({
  name: "citation",
  inline: true,
  atom: true,
  group: "inline",
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      citekey: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-citekey") ?? "",
        renderHTML: (attrs) => ({ "data-citekey": attrs.citekey }),
      },
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-title"),
        renderHTML: (attrs) =>
          attrs.title ? { "data-title": attrs.title } : {},
      },
      authors: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-authors");
          if (!raw) return null;
          try { return JSON.parse(raw); } catch { return null; }
        },
        renderHTML: (attrs) =>
          attrs.authors ? { "data-authors": JSON.stringify(attrs.authors) } : {},
      },
      year: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-year"),
        renderHTML: (attrs) =>
          attrs.year ? { "data-year": attrs.year } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="citation"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as CitationAttrs;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "citation",
        class: "citation",
      }),
      `[@${attrs.citekey}]`,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void },
          node: { attrs: CitationAttrs },
        ) {
          state.write(`[@${node.attrs.citekey}]`);
        },
        parse: {
          setup(md: MdLike) {
            const TOKEN = "citation";
            // Inline rule: matches [@citekey] where citekey is \w+ based
            // (Pandoc-style). Registered before "escape" so it runs first.
            md.inline.ruler.before("escape", TOKEN, (state, silent) => {
              const src = state.src;
              const p = state.pos;

              // Must start with [@
              if (
                src.charCodeAt(p) !== 0x5b /* [ */ ||
                src.charCodeAt(p + 1) !== 0x40 /* @ */
              ) {
                return false;
              }

              // Find closing ]
              let end = p + 2;
              while (end < state.posMax && src.charCodeAt(end) !== 0x5d /* ] */) {
                if (src.charCodeAt(end) === 0x0a /* \n */) return false;
                end++;
              }
              if (end >= state.posMax) return false;

              const citekey = src.slice(p + 2, end).trim();
              // Require non-empty, word-like citekey
              if (!citekey || !/^[\w.\-:]+$/.test(citekey)) return false;

              if (silent) return true;

              const token = state.push(TOKEN, "", 0);
              token.meta = { citekey };
              state.pos = end + 1;
              return true;
            });

            md.renderer.rules[TOKEN] = (tokens, idx) => {
              const meta = tokens[idx].meta as { citekey: string };
              const escaped = md.utils.escapeHtml(meta.citekey);
              return `<span data-type="citation" data-citekey="${escaped}"></span>`;
            };
          },
        },
      },
    };
  },
});
