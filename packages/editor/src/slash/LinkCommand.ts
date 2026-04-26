import type { Editor } from "@tiptap/core";

export interface LinkCommandPayload {
  title: string;
  targetKind: "note" | "reference" | "paper";
  targetId: string | null;
}

/**
 * Insert a wikiLink node at cursor — same payload shape the [[ typeahead emits.
 *
 * Applies the same title prefixes that wikiLinkSuggestion.command uses in
 * NoteEditor.tsx so round-tripping through markdown works correctly:
 *   reference → @<title>
 *   paper     → pdf:<title>
 *   note      → <title>
 */
export function insertWikiLink(editor: Editor, payload: LinkCommandPayload): void {
  const { title, targetKind, targetId } = payload;

  const titleWithPrefix =
    targetKind === "reference"
      ? `@${title}`
      : targetKind === "paper"
        ? `pdf:${title}`
        : title;

  editor
    .chain()
    .focus()
    .insertContent([
      {
        type: "wikiLink",
        attrs: {
          title: titleWithPrefix,
          alias: null,
          targetKind,
          targetId,
        },
      },
      { type: "text", text: " " },
    ])
    .run();
}
