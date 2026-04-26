import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { mdToProseMirror, WikiLink, TagMark } from "@episteme/markdown";

const MAX_PASTE_BYTES = 200 * 1024; // 200 KB

// Extensions that live in @episteme/editor but whose markdown parsing rules
// must be active inside the headless converter so they round-trip correctly.
const EXTRA_EXTENSIONS = [WikiLink, TagMark];

/**
 * Returns true when the pasted text looks like Markdown worth parsing:
 * - Multi-line text (contains a newline)
 * - Contains custom episteme markers: [[...]], [@...], <!-- episteme:
 */
function looksLikeMarkdown(text: string): boolean {
  if (text.includes("\n")) return true;
  if (text.includes("[[")) return true;
  if (text.includes("[@")) return true;
  if (text.includes("<!-- episteme:")) return true;
  return false;
}

/**
 * Tiptap Extension that intercepts plain-text pastes containing Markdown
 * (including episteme custom syntax) and converts them into ProseMirror nodes
 * via @episteme/markdown's `mdToProseMirror`.
 *
 * Skips if:
 * - text/html is present in the clipboard (defer to Tiptap's default HTML handler)
 * - pasted text is larger than 200 KB
 * - text does not look like Markdown
 * - mdToProseMirror throws (graceful fallback)
 */
export const MdPaste = Extension.create({
  name: "mdPaste",

  addProseMirrorPlugins() {
    // Capture editor reference from the extension context
    const editor = this.editor;

    return [
      new Plugin({
        props: {
          handlePaste(_view, event) {
            const cd = (event as ClipboardEvent).clipboardData;
            if (!cd) return false;

            // If HTML is present, let Tiptap's default handler process it
            const html = cd.getData("text/html");
            if (html) return false;

            const text = cd.getData("text/plain");
            if (!text) return false;

            // Size guard: skip huge pastes
            if (text.length > MAX_PASTE_BYTES) return false;

            // Heuristic: only intervene for MD-looking content
            if (!looksLikeMarkdown(text)) return false;

            let json;
            try {
              json = mdToProseMirror(text, EXTRA_EXTENSIONS);
            } catch {
              return false;
            }

            editor.commands.insertContent(json);
            return true;
          },
        },
      }),
    ];
  },
});
