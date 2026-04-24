import { Extension } from "@tiptap/core";

/**
 * Regex: a paragraph whose text is exactly `/ai <prompt>`.
 * Slash at line start, non-empty prompt.
 */
export const SLASH_AI_REGEX = /^\/ai\s+(.+)$/;

export type SlashAiHandler = (args: {
  prompt: string;
  context?: string;
  editor: import("@tiptap/core").Editor;
}) => void;

/**
 * Tiptap extension that intercepts Enter on a paragraph matching `/ai <prompt>`
 * BEFORE ProseMirror's default paragraph-split handler runs.
 *
 * This fixes the bug where a DOM `keydown` listener on the host div fires
 * after ProseMirror has already split the paragraph, making the regex fail.
 */
export const SlashAi = Extension.create<{
  onSlashAi: SlashAiHandler;
}>({
  name: "slashAi",

  addOptions() {
    return { onSlashAi: () => {} };
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;

        // Only match in top-level paragraphs
        if ($from.parent.type.name !== "paragraph") return false;
        // Bail if not at depth 1 (inside a list item, blockquote, etc.)
        if ($from.depth !== 1) return false;

        const paraText = $from.parent.textContent;
        const match = paraText.match(SLASH_AI_REGEX);
        if (!match) return false;

        const prompt = match[1];

        // Derive context from the previous paragraph
        const paraStart = $from.start($from.depth);
        const beforeResolved = state.doc.resolve(Math.max(0, paraStart - 1));
        const before = beforeResolved.nodeBefore;
        let context: string | undefined;
        if (before?.type.name === "paragraph") {
          const prevText = before.textContent.trim();
          if (prevText) context = prevText;
        }

        // Delete the `/ai <prompt>` line
        const paraEnd = $from.end($from.depth);
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.delete(paraStart, paraEnd);
            return true;
          })
          .run();

        this.options.onSlashAi({ prompt, context, editor });
        return true; // We handled Enter — don't let ProseMirror split the paragraph
      },
    };
  },
});