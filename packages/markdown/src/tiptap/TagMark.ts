import { Mark, markInputRule } from "@tiptap/core";

// Matches `#tag` where tag = [a-z][a-z0-9_-]*, preceded by start-of-text or
// whitespace. Single capture group holding the full `#tag` — markInputRule
// uses the LAST capture as the wrap range, so wrapping must include the `#`
// (otherwise the `#` is deleted between match-start and wrap-start).
// InputRule fires when the user types a non-word character after a valid tag.
const TAG_INPUT_RULE = /(?:^|\s)(#[a-z][a-z0-9_-]*)(?=[^\w]|$)/;

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
        parse: {},
      },
    };
  },

  addInputRules() {
    return [
      markInputRule({
        find: TAG_INPUT_RULE,
        type: this.type,
        getAttributes: (match) => ({ tag: match[1].slice(1) }),
      }),
    ];
  },
});
