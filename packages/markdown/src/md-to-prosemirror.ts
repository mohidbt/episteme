import { Editor } from "@tiptap/core";
import { createExtensions } from "./extensions.js";

export function mdToProseMirror(md: string): unknown {
  const editor = new Editor({
    extensions: createExtensions(),
    content: "",
  });
  // tiptap-markdown registers a `setContent` that parses markdown when the
  // content is a string; passing the string directly via commands triggers it.
  editor.commands.setContent(md ?? "");
  const json = editor.getJSON();
  editor.destroy();
  return json;
}
