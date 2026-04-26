import { Editor, Extension, Mark, Node, type JSONContent } from "@tiptap/core";
import { createExtensions } from "./extensions";

type AnyExtension = Extension | Node | Mark;

/**
 * Convert a Markdown string to a ProseMirror JSONContent document.
 *
 * @param md - The Markdown source to parse.
 * @param extraExtensions - Additional Tiptap extensions to register in the
 *   headless editor (e.g. WikiLink, TagMark). These are appended after the
 *   base set returned by `createExtensions()`.
 */
export function mdToProseMirror(
  md: string,
  extraExtensions: AnyExtension[] = [],
): JSONContent {
  const editor = new Editor({
    extensions: [...createExtensions(), ...extraExtensions],
  });
  // tiptap-markdown registers a `setContent` that parses markdown when the
  // content is a string; passing the string directly via commands triggers it.
  editor.commands.setContent(md);
  const json = editor.getJSON();
  editor.destroy();
  return json;
}
