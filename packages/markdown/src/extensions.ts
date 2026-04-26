import { Mark } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Italic from "@tiptap/extension-italic";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";
import { Markdown } from "tiptap-markdown";
import { Citation } from "./tiptap/Citation";
import { PdfEmbed } from "./tiptap/PdfEmbed";

// Register both short and long-form aliases so common fence variants
// (```python, ```rust, ```typescript, etc.) all highlight.
const lowlight = createLowlight();
lowlight.register("ts", typescript);
lowlight.register("typescript", typescript);
lowlight.register("tsx", typescript);
lowlight.register("js", javascript);
lowlight.register("javascript", javascript);
lowlight.register("py", python);
lowlight.register("python", python);
lowlight.register("rs", rust);
lowlight.register("rust", rust);
lowlight.register("go", go);
lowlight.register("bash", bash);
lowlight.register("sh", bash);
lowlight.register("shell", bash);
lowlight.register("json", json);
lowlight.register("md", markdown);
lowlight.register("markdown", markdown);
lowlight.register("sql", sql);
lowlight.register("yaml", yaml);
lowlight.register("yml", yaml);

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

export const createExtensions = (opts?: {
  collaborative?: boolean;
  // Optional NodeView extender — passed in by callers that have React in scope
  // (e.g. apps/km via @episteme/editor). When provided, the function it returns
  // is applied to CodeBlockLowlight via .extend() so the editor renders a React
  // NodeView (used here for the language switcher dropdown). Headless callers
  // (markdown package tests, server-side md round-trip) leave this unset and
  // get a plain extension with no React dependency.
  codeBlockExtend?: (ext: typeof CodeBlockLowlight) => typeof CodeBlockLowlight;
}) => {
  const codeBlock = (opts?.codeBlockExtend ?? ((e) => e))(CodeBlockLowlight);
  const exts = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      italic: false,
      // CodeBlockLowlight replaces StarterKit's built-in CodeBlock.
      codeBlock: false,
      // Collaboration extension owns undo/redo — StarterKit history must be off.
      history: opts?.collaborative ? false : undefined,
    }),
    codeBlock.configure({ lowlight, defaultLanguage: null }),
    ItalicUnderscore,
    Link,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
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
