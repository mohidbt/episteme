import { InputRule } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Italic from "@tiptap/extension-italic";
import TiptapLink from "@tiptap/extension-link";
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

// Full @tiptap/extension-link, extended with a markdown-link input rule so
// typing `[text](url)` followed by a space compiles the range into a link
// mark. autolink + linkOnPaste handle bare-URL paste and selection
// paste-as-link (see Bug D6).
//
// markdown-link input rule: `[text](url)` followed by a space. Space is the
// only trigger character (Tiptap InputRule fires on typed character input;
// Enter is handled by separate keymaps and does not flow through here).
// Replaces the literal markdown range with the link text carrying a link
// mark to the URL, plus an unmarked trailing space so the caret continues
// outside the link (no inclusive-mark drag).
const MARKDOWN_LINK_INPUT_REGEX = /\[([^\]]+)\]\(([^)\s]+)\) $/;

const Link = TiptapLink.extend({
  addInputRules() {
    return [
      ...(this.parent?.() ?? []),
      new InputRule({
        find: MARKDOWN_LINK_INPUT_REGEX,
        handler: ({ state, range, match }) => {
          const [, label, href] = match;
          if (!label || !href) return null;
          const mark = state.schema.marks.link.create({ href });
          state.tr
            .replaceWith(range.from, range.to, [
              state.schema.text(label, [mark]),
              state.schema.text(" "),
            ])
            .setMeta("preventAutolink", true);
        },
      }),
    ];
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
    Link.configure({
      openOnClick: true,
      autolink: true,
      linkOnPaste: true,
    }),
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
