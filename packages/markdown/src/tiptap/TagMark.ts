import { InputRule, Mark } from "@tiptap/core";

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
        parse: {},
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
