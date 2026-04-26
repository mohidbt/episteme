import type { Editor } from "@tiptap/core";

export interface PdfCommandPayload {
  pdfId: string;
  title: string;
  page: number | null;
}

/**
 * Insert a PdfEmbed block node at cursor.
 */
export function insertPdfEmbed(editor: Editor, payload: PdfCommandPayload): void {
  const { pdfId, title, page } = payload;
  editor
    .chain()
    .focus()
    .insertContent({
      type: "pdfEmbed",
      attrs: { pdfId, title, page: page ?? null },
    })
    .run();
}
