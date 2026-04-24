import { Mark } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Italic from "@tiptap/extension-italic";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { Citation } from "./tiptap/Citation";
import { PdfEmbed } from "./tiptap/PdfEmbed";

// Minimal Link mark so tiptap-markdown's link parser/serializer activates.
// We don't need the full @tiptap/extension-link (click handling, paste rules)
// for headless MD round-tripping.
const Link = Mark.create({
  name: "link",
  addAttributes() {
    return {
      href: { default: null },
      title: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "a[href]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["a", HTMLAttributes, 0];
  },
});

// Override italic's markdown serialize delimiters to use `_..._` instead of
// the default `*...*`. tiptap-markdown merges an extension's
// `storage.markdown` over its defaults (see getMarkdownSpec), so this
// survives the StarterKit -> Italic chain without touching serialized output
// post-hoc (which would corrupt `*` inside code spans / fenced blocks).
const ItalicUnderscore = Italic.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: "_", close: "_", mixable: true, expelEnclosingWhitespace: true },
        parse: {},
      },
    };
  },
});

export const createExtensions = () => {
  const exts = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      italic: false,
    }),
    ItalicUnderscore,
    Link,
    TaskList,
    TaskItem.configure({ nested: true }),
    Citation,
    PdfEmbed,
    // NOTE: Task 3's live editor will want `transformPastedText: true` so
    // pasted markdown is parsed into nodes; keep it false here for headless
    // round-tripping where we already pass a markdown string to setContent.
    Markdown.configure({
      html: false,
      tightLists: true,
      bulletListMarker: "-",
      linkify: false,
      breaks: false,
      transformPastedText: false,
      transformCopiedText: false,
    }),
  ];
  return exts;
};
