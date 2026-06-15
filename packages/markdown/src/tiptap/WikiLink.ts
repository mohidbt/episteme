import { InputRule, Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { MdLike } from "./markdown-it-types";

export type WikiLinkTargetKind = "note" | "reference" | "paper" | null;

// Prefix classifier shared by the InputRule (typing `[[...]]` in the editor)
// and the markdown-it parse rule (rendering saved markdown back to nodes).
// Keep in sync with the regex-based classifier in
// `packages/markdown/src/wiki-link-regex.ts` — these are the same syntax
// rules; that one runs over raw markdown while this one runs inside the
// Tiptap layer where we also need to strip the prefix from the display title.
// Order matters: `p:` / `r:` short-forms take precedence over legacy
// `@` / `pdf:`.
export function classifyWikiTarget(inner: string): {
  kind: "note" | "reference" | "paper";
  title: string;
} {
  const t = inner.trim();
  if (/^p:/i.test(t)) return { kind: "paper", title: t.replace(/^p:/i, "").trim() };
  if (/^r:/i.test(t)) return { kind: "reference", title: t.replace(/^r:/i, "").trim() };
  if (t.startsWith("@")) return { kind: "reference", title: t.slice(1).trim() };
  if (/^pdf:/i.test(t)) return { kind: "paper", title: t.replace(/^pdf:/i, "").trim() };
  return { kind: "note", title: t };
}

export interface WikiLinkAttrs {
  title: string;
  alias: string | null;
  targetKind: WikiLinkTargetKind;
  targetId: string | null;
  // GSD-62: resolved display label (e.g. paper.title from the DB). Populated
  // by `hydrateWikiLinkResolutions` after the note loads; render-time only,
  // NOT serialized to markdown. Falls back to `title` when null.
  displayTitle: string | null;
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

// lucide NotebookText (GSD-106): visual parity icon for note-kind chips so
// they match the paper (FileText) and reference (BookMarked) chip shape.
const NOTEBOOK_TEXT_PATHS: ReadonlyArray<string> = [
  "M2 6h4",
  "M2 10h4",
  "M2 14h4",
  "M2 18h4",
  "M4 2v20",
  "M20.4 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12.4a.6.6 0 0 0 .6-.6V2.6a.6.6 0 0 0-.6-.6z",
  "M9.5 8h7",
  "M9.5 12h7",
  "M9.5 16h4",
];

function iconSpec(paths: ReadonlyArray<string>): unknown[] {
  return ["svg", SVG_ATTRS, ...paths.map((d) => ["path", { d }])];
}

// K6 self-heal plugin: YJS-stored ProseMirror nodes that predate the K6
// classifier have `targetKind: null` and `title: "pdf:foo"` / `"@bib"` /
// `"p:foo"` / `"r:bar"` (raw, prefix included). They bypass markdown-it
// because YJS hydrates ProseMirror state directly. On every transaction we
// scan wikiLink nodes; if a node's title carries a known prefix, we rewrite
// its attrs with the classified kind + stripped title. Idempotent —
// already-classified (no prefix) nodes are skipped because
// classifyWikiTarget returns `{kind: "note", title: t}` unchanged for them.
const SELF_HEAL_KEY = new PluginKey("wikiLinkSelfHeal");
function hasKnownPrefix(t: string): boolean {
  return (
    /^p:/i.test(t) || /^r:/i.test(t) || t.startsWith("@") || /^pdf:/i.test(t)
  );
}
type PMState = { doc: import("@tiptap/pm/model").Node; tr: import("@tiptap/pm/state").Transaction };
function buildHealTr(state: PMState): import("@tiptap/pm/state").Transaction | null {
  const tr = state.tr;
  let touched = false;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "wikiLink") return;
    const title = typeof node.attrs.title === "string" ? node.attrs.title : "";
    // Heal only when title carries a known prefix. Plain `[[Note]]` with
    // null kind renders identically to kind="note" (renderHTML omits the
    // attr + skips icon), so we avoid touching it to keep this transparent.
    if (!title || !hasKnownPrefix(title)) return;
    const { kind, title: stripped } = classifyWikiTarget(title);
    if (stripped === title && node.attrs.targetKind === kind) return;
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      title: stripped,
      targetKind: kind,
    });
    touched = true;
  });
  return touched ? tr : null;
}

const wikiLinkSelfHealPlugin = new Plugin({
  key: SELF_HEAL_KEY,
  // Heal on every transaction (covers later YJS sync events that hydrate
  // stale nodes after initial mount).
  appendTransaction(_trs, _oldState, newState) {
    const tr = buildHealTr(newState);
    if (tr === null) return null;
    tr.setMeta("addToHistory", false);
    return tr;
  },
  // Heal at initial view mount — `appendTransaction` does NOT fire for the
  // initial state, only for dispatched transactions. Without this, a doc
  // hydrated entirely from stale state at mount stays unhealed until the
  // first edit.
  view(view) {
    const tr = buildHealTr(view.state);
    if (tr !== null) {
      tr.setMeta("addToHistory", false);
      view.dispatch(tr);
    }
    return {};
  },
});

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
      // GSD-62: resolved display label, not part of markdown round-trip.
      // Persisted on the ProseMirror node so YJS broadcasts it to collaborators
      // (avoids each peer re-resolving). Render-time fallback chain is
      // `alias ?? displayTitle ?? title`.
      displayTitle: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute("data-display-title"),
        renderHTML: (attrs) =>
          attrs.displayTitle
            ? { "data-display-title": attrs.displayTitle }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="wiki-link"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as WikiLinkAttrs;
    const resolved = attrs.targetId != null;
    // GSD-62: alias (user override) > displayTitle (resolved DB title) > title (raw token).
    const label = attrs.alias ?? attrs.displayTitle ?? attrs.title;
    // GSD-106: note kind now gets its own modifier + icon so it matches the
    // paper/reference chip shape (icon + colored hover). Legacy nodes with
    // targetKind=null (pre-classifier) still render plain.
    const kindClass =
      attrs.targetKind === "paper"
        ? " wiki-link--paper"
        : attrs.targetKind === "reference"
          ? " wiki-link--reference"
          : attrs.targetKind === "note"
            ? " wiki-link--note"
            : "";
    const icon =
      attrs.targetKind === "paper"
        ? iconSpec(FILE_TEXT_PATHS)
        : attrs.targetKind === "reference"
          ? iconSpec(BOOK_MARKED_PATHS)
          : attrs.targetKind === "note"
            ? iconSpec(NOTEBOOK_TEXT_PATHS)
            : null;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "wiki-link",
        "data-resolved": resolved ? "true" : "false",
        class: PILL_CLASS + kindClass,
      }),
      ...(icon ? [icon] : []),
      // GSD-89: wrap label in an inline-block span so `text-overflow: ellipsis`
      // resolves on a real block formatting context rather than a bare text
      // node that becomes an anonymous flex item and overflows mid-glyph.
      ["span", { class: "wiki-link__label" }, label],
      // Tiptap's DOMOutputSpec union is narrower than what we emit (a span
      // with mixed-arity children: optional svg + label span). Cast keeps the
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
          const rawInner = match[1].trim();
          const rawAlias = match[2]?.trim() || null;
          if (!rawInner) return;
          // Classify by prefix so the pill renders the right icon
          // immediately on typing — without waiting for markdown reload.
          const { kind, title } = classifyWikiTarget(rawInner);
          if (!title) return;
          const { tr } = state;
          tr.replaceWith(
            range.from,
            range.to,
            type.create({
              title,
              alias: rawAlias,
              targetKind: kind,
              targetId: null,
            }),
          );
        },
      }),
    ];
  },

  // N6 v3 REAL RC: ProseMirror's DOMOutputSpec creates elements via
  // `document.createElement`, which puts `<svg>` in the XHTML namespace and
  // makes its `<path>` children render at 0×0 (invisible icon). The
  // serialization path (renderHTML → getHTML string) still works because the
  // HTML parser re-applies the SVG namespace when reading the string. But
  // live editor rendering bypasses that string parser, so we install a
  // NodeView that builds the icon via `createElementNS` with the correct
  // namespace.
  addNodeView() {
    return ({ node, HTMLAttributes }: { node: PMNode; HTMLAttributes: Record<string, unknown> }) => {
      const buildDom = (n: PMNode): HTMLSpanElement => {
        const attrs = n.attrs as WikiLinkAttrs;
        const resolved = attrs.targetId != null;
        const kindClass =
          attrs.targetKind === "paper"
            ? " wiki-link--paper"
            : attrs.targetKind === "reference"
              ? " wiki-link--reference"
              : attrs.targetKind === "note"
                ? " wiki-link--note"
                : "";
        const label = attrs.alias ?? attrs.displayTitle ?? attrs.title;
        const merged = mergeAttributes(HTMLAttributes, {
          "data-type": "wiki-link",
          "data-resolved": resolved ? "true" : "false",
          "data-title": attrs.title,
          ...(attrs.alias ? { "data-alias": attrs.alias } : {}),
          ...(attrs.targetKind ? { "data-target-kind": attrs.targetKind } : {}),
          ...(attrs.targetId ? { "data-target-id": attrs.targetId } : {}),
          ...(attrs.displayTitle
            ? { "data-display-title": attrs.displayTitle }
            : {}),
          class: PILL_CLASS + kindClass,
        });
        const span = document.createElement("span");
        for (const [k, v] of Object.entries(merged)) {
          if (v == null) continue;
          span.setAttribute(k, String(v));
        }
        // GSD-89 Bug 2: atom NodeViews must mark their DOM as non-editable so
        // ProseMirror treats the entire wrapper as a single atomic leaf for
        // cursor mapping. Without this, ArrowRight steps into the text child
        // instead of past the chip. The renderHTML path gets this for free
        // because ProseMirror applies it automatically; the custom NodeView
        // owns the DOM, so we have to declare it explicitly.
        span.setAttribute("contenteditable", "false");
        const paths =
          attrs.targetKind === "paper"
            ? FILE_TEXT_PATHS
            : attrs.targetKind === "reference"
              ? BOOK_MARKED_PATHS
              : attrs.targetKind === "note"
                ? NOTEBOOK_TEXT_PATHS
                : null;
        if (paths) {
          const SVG_NS = "http://www.w3.org/2000/svg";
          const svg = document.createElementNS(SVG_NS, "svg");
          for (const [k, v] of Object.entries(SVG_ATTRS)) {
            svg.setAttribute(k, String(v));
          }
          for (const d of paths) {
            const path = document.createElementNS(SVG_NS, "path");
            path.setAttribute("d", d);
            svg.appendChild(path);
          }
          span.appendChild(svg);
        }
        // GSD-89 Bug 1: wrap label in an inline-block span (see renderHTML
        // comment + .wiki-link__label CSS) so ellipsis resolves correctly
        // when the chip is laid out as `inline-flex`.
        const labelSpan = document.createElement("span");
        labelSpan.className = "wiki-link__label";
        labelSpan.appendChild(document.createTextNode(label));
        span.appendChild(labelSpan);
        return span;
      };
      let dom = buildDom(node);
      return {
        dom,
        // Atom node: no editable content child. ProseMirror won't try to
        // manage descendants.
        update(updatedNode: PMNode) {
          if (updatedNode.type.name !== "wikiLink") return false;
          const fresh = buildDom(updatedNode);
          dom.replaceWith(fresh);
          dom = fresh;
          return true;
        },
      };
    };
  },

  // K6 self-heal: YJS-stored ProseMirror nodes that predate the K6 classifier
  // have `targetKind: null` and `title: "pdf:foo.pdf"` (raw, prefix included).
  // They bypass markdown-it (YJS hydrates directly into ProseMirror), so the
  // classifier never sees them. This plugin runs `classifyWikiTarget` over
  // every wikiLink node on each transaction; if a node's stored title still
  // carries a known prefix OR targetKind is null & title matches a prefix, it
  // rewrites the attrs with the classified kind + stripped title. Idempotent:
  // already-classified nodes are skipped.
  addProseMirrorPlugins() {
    return [wikiLinkSelfHealPlugin];
  },

  addStorage() {
    return {
      markdown: {
        // tiptap-markdown reads `storage.markdown.serialize` per-extension and
        // invokes this for each node of our type. We write the raw `[[..]]`
        // token; nothing else needs escaping.
        //
        // K6: `targetKind` MUST be re-encoded into the markdown prefix.
        // Both ingress paths (InputRule + markdown-it parse) strip the
        // `p:` / `r:` / `@` / `pdf:` prefix from `title` and store the kind
        // separately in `targetKind`. If we emit `[[${title}]]` with no
        // prefix, the next reload re-parses with kind=note and the pill
        // loses its icon / class. So `paper` → `p:`, `reference` → `r:`
        // (the modern short forms; legacy `@` and `pdf:` still parse on
        // ingress for back-compat).
        serialize(
          state: { write: (s: string) => void },
          node: { attrs: WikiLinkAttrs },
        ) {
          const { title, alias, targetKind } = node.attrs;
          const prefix =
            targetKind === "paper"
              ? "p:"
              : targetKind === "reference"
                ? "r:"
                : "";
          const inner = `${prefix}${title}`;
          state.write(alias ? `[[${inner}|${alias}]]` : `[[${inner}]]`);
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
              const innerRaw = (pipeIdx === -1 ? raw : raw.slice(0, pipeIdx)).trim();
              const alias =
                pipeIdx === -1 ? null : raw.slice(pipeIdx + 1).trim() || null;
              if (!innerRaw) return false;
              // Classify prefix so the rendered span carries
              // `data-target-kind` — without this, the parseHTML round-trip
              // would leave targetKind=null and icons would not render.
              const { kind, title } = classifyWikiTarget(innerRaw);
              if (!title) return false;
              if (silent) return true;
              const token = state.push(TOKEN, "", 0);
              token.meta = { title, alias, targetKind: kind };
              state.pos = end + (escaped ? 4 : 2);
              return true;
            });
            md.renderer.rules[TOKEN] = (tokens, idx) => {
              const meta = tokens[idx].meta as {
                title: string;
                alias: string | null;
                targetKind: "note" | "reference" | "paper";
              };
              const label = meta.alias ?? meta.title;
              const titleAttr = md.utils.escapeHtml(meta.title);
              const aliasAttr = meta.alias
                ? ` data-alias="${md.utils.escapeHtml(meta.alias)}"`
                : "";
              const kindAttr = ` data-target-kind="${meta.targetKind}"`;
              return `<span data-type="wiki-link" data-title="${titleAttr}"${aliasAttr}${kindAttr} data-resolved="false">${md.utils.escapeHtml(label)}</span>`;
            };
          },
        },
      },
    };
  },
});

