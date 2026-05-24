import type { Editor } from "@tiptap/core";

export interface LinkCommandPayload {
  title: string;
  targetKind: "note" | "reference" | "paper";
  targetId: string | null;
}

/**
 * Insert a wikiLink node at cursor — same payload shape the [[ typeahead emits.
 *
 * K6: WikiLink stores STRIPPED title + separate `targetKind` attr; the
 * markdown serializer re-encodes the prefix (`p:` for paper, `r:` for
 * reference) so reloads round-trip the kind. Do NOT pre-prefix the title
 * here — that would double-encode on serialize.
 */
export function insertWikiLink(editor: Editor, payload: LinkCommandPayload): void {
  const { title, targetKind, targetId } = payload;

  editor
    .chain()
    .focus()
    .insertContent([
      {
        type: "wikiLink",
        attrs: {
          title,
          alias: null,
          targetKind,
          targetId,
        },
      },
      { type: "text", text: " " },
    ])
    .run();
}
