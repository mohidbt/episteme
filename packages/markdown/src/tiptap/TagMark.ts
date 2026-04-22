import { InputRule, Mark } from "@tiptap/core";
import type { MdLike } from "./markdown-it-types";

// Fires when the user types a trailing space after a `#tag`. The trailing
// space is the trigger — without it, `markInputRule` would fire on each
// typed letter (via `$` end-of-input), and ProseMirror's InputRule plugin
// would replace the default text insertion with the mark-only transform,
// swallowing the typed character.
const TAG_INPUT_RULE = /(?:^|[^\w])(#[a-z][a-z0-9_-]*)( )$/;

export const TagMark = Mark.create({
  name: "tag",
  inclusive: false,

  addAttributes() {
    return {
      tag: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-tag") ?? "",
        renderHTML: (attrs) => ({ "data-tag": attrs.tag }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="tag"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      {
        ...HTMLAttributes,
        "data-type": "tag",
        class: "text-primary font-mono text-sm",
      },
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        // The mark's text content in the document is already `#tag` (the user
        // typed it literally). tiptap-markdown serializes mark text content
        // unchanged when we return a no-op wrapper (empty open/close strings).
        // This keeps markdown round-trips clean: `#ml` stays `#ml`.
        serialize: {
          open: "",
          close: "",
          mixable: true,
          expelEnclosingWhitespace: false,
        },
        // Inline markdown-it rule for `#tag`. The renderer emits the same
        // `span[data-type="tag"]` HTML that parseHTML above matches, so
        // tiptap-markdown's pipeline (setContent(md) -> md.render -> parseHTML)
        // reattaches the tag mark to the `#tag` text node on load. Because this
        // fires as an inline rule, markdown-it has already stripped code spans
        // and code blocks from the input it hands us — so `#ml` inside
        // backticks is never visited.
        parse: {
          setup(md: MdLike) {
            const TOKEN = "hashtag";
            md.inline.ruler.after("emphasis", TOKEN, (state, silent) => {
              if (state.src.charCodeAt(state.pos) !== 0x23 /* # */) return false;
              // Boundary: must not be preceded by a word char (so `issue#123`
              // is not a tag).
              if (state.pos > 0) {
                const prev = state.src.charCodeAt(state.pos - 1);
                const isPrevWord =
                  (prev >= 0x30 && prev <= 0x39) ||
                  (prev >= 0x41 && prev <= 0x5a) ||
                  (prev >= 0x61 && prev <= 0x7a) ||
                  prev === 0x5f; /* _ */
                if (isPrevWord) return false;
              }
              const start = state.pos + 1;
              const first = state.src.charCodeAt(start);
              const isLower = first >= 0x61 && first <= 0x7a;
              if (!isLower) return false;
              let end = start + 1;
              while (end < state.posMax) {
                const c = state.src.charCodeAt(end);
                const isTagChar =
                  (c >= 0x61 && c <= 0x7a) ||
                  (c >= 0x30 && c <= 0x39) ||
                  c === 0x5f ||
                  c === 0x2d;
                if (!isTagChar) break;
                end += 1;
              }
              const tag = state.src.slice(start, end);
              if (!tag) return false;
              if (silent) return true;
              const token = state.push(TOKEN, "", 0);
              token.meta = { tag };
              state.pos = end;
              return true;
            });
            md.renderer.rules[TOKEN] = (tokens, idx) => {
              const meta = tokens[idx].meta as { tag: string };
              const escaped = md.utils.escapeHtml(meta.tag);
              return `<span data-type="tag" data-tag="${escaped}">#${escaped}</span>`;
            };
          },
        },
      },
    };
  },

  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: TAG_INPUT_RULE,
        handler: ({ state, range, match }) => {
          const tagToken = match[1];
          const tag = tagToken.slice(1);
          const tokenOffset = match[0].indexOf(tagToken);
          const markFrom = range.from + tokenOffset;
          const markTo = markFrom + tagToken.length;
          const { tr } = state;
          // The rule's transform REPLACES the default space insertion, so we
          // re-insert the space ourselves before marking the `#tag` range.
          tr.insertText(" ", markTo);
          tr.addMark(markFrom, markTo, type.create({ tag }));
          tr.removeStoredMark(type);
        },
      }),
    ];
  },
});
