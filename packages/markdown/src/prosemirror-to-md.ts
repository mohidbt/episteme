import { Editor, type JSONContent } from "@tiptap/core";
import { createExtensions } from "./extensions";

// Post-process the tiptap-markdown output to match our preferred dialect:
// italic `*..*` -> `_.._` is handled by overriding the italic mark's
// markdown serialize tokens in extensions.ts (see ItalicUnderscore). That
// means we don't need a regex over the full output string, which would
// corrupt `*` characters inside inline code spans and fenced code blocks.
// The only leftover is unescaping bracket escapes that prosemirror-markdown
// introduces via esc(); we want `[[wikilink]]` to round-trip byte-for-byte
// since wikilinks are plain text in this phase.
function postProcess(md: string): string {
  return md.replace(/\\([\[\]])/g, "$1");
}

export function proseMirrorToMd(doc: JSONContent): string {
  const editor = new Editor({
    extensions: createExtensions(),
    content: doc,
  });
  const storage = editor.storage as { markdown?: { getMarkdown: () => string } };
  const md = storage.markdown?.getMarkdown() ?? "";
  editor.destroy();
  return postProcess(md);
}
