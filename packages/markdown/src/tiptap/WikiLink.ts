import { InputRule, Node, mergeAttributes } from "@tiptap/core";
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

// Lucide icon path data (v0). Kept as inline DOMOutputSpec children so the
// renderHTML output stays a single synchronous DOM spec (no React, no async).
const SVG_ATTRS = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
};

// lucide FileText
const FILE_TEXT_PATHS: ReadonlyArray<string> = [
  "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
  "M14 2v4a2 2 0 0 0 2 2h4",
  "M10 9H8",
  "M16 13H8",
  "M16 17H8",
];

// lucide BookMarked
const BOOK_MARKED_PATHS: ReadonlyArray<string> = [
  "M10 2v8l3-3 3 3V2",
  "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
];

function iconSpec(paths: ReadonlyArray<string>): unknown[] {
  return ["svg", SVG_ATTRS, ...paths.map((d) => ["path", { d }])];
}

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
    const kindClass =
      attrs.targetKind === "paper"
        ? " wiki-link--paper"
        : attrs.targetKind === "reference"
          ? " wiki-link--reference"
          : "";
    const icon =
      attrs.targetKind === "paper"
        ? iconSpec(FILE_TEXT_PATHS)
        : attrs.targetKind === "reference"
          ? iconSpec(BOOK_MARKED_PATHS)
          : null;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "wiki-link",
        "data-resolved": resolved ? "true" : "false",
        class: PILL_CLASS + kindClass,
      }),
      ...(icon ? [icon] : []),
      label,
      // Tiptap's DOMOutputSpec union is narrower than what we emit (a span
      // with mixed-arity children: optional svg + text). Cast keeps the
      // public types untouched while letting ProseMirror serialize it as a
      // standard DOM spec.
    ] as never;
  },

  // Fires the moment the user types the closing `]]` of a `[[Title]]` or
  // `[[Title|Alias]]`. Converts the range into a wikiLink node so the pill
  // appears inline without waiting for a reload. Resolution stays null; the
  // next autosave's rebuildLinks + reload hydration will fill targetId.
  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: /\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]+))?\]\]$/,
        handler: ({ state, range, match }) => {
          const rawTitle = match[1].trim();
          const rawAlias = match[2]?.trim() || null;
          if (!rawTitle) return;
          const { tr } = state;
          tr.replaceWith(
            range.from,
            range.to,
            type.create({
              title: rawTitle,
              alias: rawAlias,
              targetKind: null,
              targetId: null,
            }),
          );
        },
      }),
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
            // Registered BEFORE the built-in `escape` rule so we get first
            // crack at `\[\[..\]\]`. Otherwise markdown-it's escape rule
            // would consume each `\[` as a text `[` and our opener scan
            // would never match. Content stored from before the typeahead
            // existed is saved in the escaped form by tiptap-markdown's
            // default serializer — we still want those to render as pills.
            md.inline.ruler.before("escape", TOKEN, (state, silent) => {
              const src = state.src;
              let p = state.pos;
              let escaped: boolean;
              // Unescaped opener: `[[`
              if (
                src.charCodeAt(p) === 0x5b /* [ */ &&
                src.charCodeAt(p + 1) === 0x5b
              ) {
                escaped = false;
                p += 2;
              }
              // Escaped opener: `\[\[`
              else if (
                src.charCodeAt(p) === 0x5c /* \ */ &&
                src.charCodeAt(p + 1) === 0x5b &&
                src.charCodeAt(p + 2) === 0x5c &&
                src.charCodeAt(p + 3) === 0x5b
              ) {
                escaped = true;
                p += 4;
              } else {
                return false;
              }

              const start = p;
              let end = start;
              while (end < state.posMax) {
                const c = src.charCodeAt(end);
                if (c === 0x0a /* \n */) return false;
                if (escaped) {
                  if (
                    c === 0x5c /* \ */ &&
                    src.charCodeAt(end + 1) === 0x5d /* ] */ &&
                    src.charCodeAt(end + 2) === 0x5c &&
                    src.charCodeAt(end + 3) === 0x5d
                  )
                    break;
                } else {
                  if (
                    c === 0x5d /* ] */ &&
                    src.charCodeAt(end + 1) === 0x5d
                  )
                    break;
                }
                end += 1;
              }
              if (end >= state.posMax) return false;
              const raw = src.slice(start, end);
              if (raw.length === 0 || raw.includes("[[")) return false;
              const pipeIdx = raw.indexOf("|");
              const title = (pipeIdx === -1 ? raw : raw.slice(0, pipeIdx)).trim();
              const alias =
                pipeIdx === -1 ? null : raw.slice(pipeIdx + 1).trim() || null;
              if (!title) return false;
              if (silent) return true;
              const token = state.push(TOKEN, "", 0);
              token.meta = { title, alias };
              state.pos = end + (escaped ? 4 : 2);
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
