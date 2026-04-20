import { Mark } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";

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

export const createExtensions = () => {
  const exts = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Link,
    TaskList,
    TaskItem.configure({ nested: true }),
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

export const coreExtensions = createExtensions();
