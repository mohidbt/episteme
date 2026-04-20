import { Editor } from "@tiptap/core";
import { createExtensions } from "./extensions.js";

// Post-process the tiptap-markdown output to match our preferred dialect:
// - italic uses `_..._` instead of `*...*` (matches our sample set).
// - bracket characters are not escaped (preserves `[[wikilink]]` byte-for-byte
//   since wikilinks are plain text in this phase).
function postProcess(md: string): string {
  let out = md;
  // Single-asterisk emphasis -> underscore. Avoid touching `**bold**` (double).
  // Match a single `*`, some content without `*`, then a single `*`.
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1_$2_");
  // Unescape bracket escapes introduced by prosemirror-markdown's `esc()`.
  out = out.replace(/\\([\[\]])/g, "$1");
  return out;
}

export function proseMirrorToMd(doc: unknown): string {
  const editor = new Editor({
    extensions: createExtensions(),
    content: doc as any,
  });
  const storage = editor.storage as { markdown?: { getMarkdown: () => string } };
  const md = storage.markdown?.getMarkdown() ?? "";
  editor.destroy();
  return postProcess(md);
}
