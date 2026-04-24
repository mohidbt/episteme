import type { Editor } from "@tiptap/core";
import type { CitationAttrs } from "@episteme/markdown";

export interface CiteCommandPayload {
  citekey: string;
  title: string;
  authors: string[];
  year: string | null;
}

/**
 * Insert a Citation node at cursor and manage the bibliography footer.
 *
 * Bibliography policy (minimal):
 * - On first citation in doc: append a "**Bibliography**" heading paragraph +
 *   an ordered list. Subsequent picks append to the same list.
 * - If a bibliography already exists (detected by paragraph text starting with
 *   "**Bibliography**"), reuse it.
 * - The [n] index in the Citation node reflects 1-based position in the list.
 */
export function insertCitation(editor: Editor, payload: CiteCommandPayload): void {
  const { citekey, title, authors, year } = payload;

  // Determine the citation number by counting existing citations in the doc
  const json = editor.getJSON();
  let citationCount = 0;
  countCitations(json, citekey, (count) => { citationCount = count; });

  const citationIndex = citationCount + 1;

  const citationAttrs: CitationAttrs = {
    citekey,
    title,
    authors,
    year,
  };

  // Build the bibliography list item content
  const authorsStr = authors.slice(0, 3).join(", ") + (authors.length > 3 ? " et al." : "");
  const bibEntry = year
    ? `${authorsStr} (${year}). ${title}.`
    : `${authorsStr}. ${title}.`;

  editor.chain().focus().insertContent({ type: "citation", attrs: citationAttrs }).run();

  // Now manage bibliography footer
  ensureBibliography(editor, bibEntry);
}

function countCitations(
  node: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] },
  targetCitekey: string,
  cb: (count: number) => void,
): void {
  let count = 0;
  function walk(n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }) {
    if (n.type === "citation") {
      count++;
    }
    if (n.content) {
      for (const child of n.content) {
        walk(child as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] });
      }
    }
  }
  walk(node);
  cb(count);
}

function ensureBibliography(editor: Editor, bibEntry: string): void {
  const doc = editor.getJSON();
  const content = doc.content ?? [];

  // Check if a bibliography heading already exists
  const hasBib = content.some((node) => {
    if (node.type !== "paragraph") return false;
    const text = node.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "";
    return text.startsWith("Bibliography");
  });

  if (hasBib) {
    // Find the ordered list after the bibliography heading and append
    const bibIdx = content.findIndex((node) => {
      if (node.type !== "paragraph") return false;
      const text = node.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "";
      return text.startsWith("Bibliography");
    });

    const listNode = content[bibIdx + 1];
    if (listNode?.type === "orderedList") {
      // Append a new list item
      editor.chain().focus().command(({ tr, state }) => {
        // Find the ordered list in the doc and insert a list item
        const docNode = state.doc;
        let listPos = -1;
        docNode.forEach((node, pos) => {
          if (node.type.name === "orderedList" && listPos === -1) {
            // Check if this is the bibliography list (after bibliography heading)
            const beforeNode = docNode.resolve(Math.max(0, pos - 1)).nodeBefore;
            const beforeText = beforeNode?.textContent ?? "";
            if (beforeText.includes("Bibliography")) {
              listPos = pos;
            }
          }
        });
        if (listPos === -1) return false;
        const listNode = docNode.nodeAt(listPos);
        if (!listNode) return false;
        const listEndPos = listPos + listNode.nodeSize - 1;
        const listItem = state.schema.nodes.listItem?.createAndFill(
          {},
          state.schema.nodes.paragraph?.create({}, state.schema.text(bibEntry)),
        );
        if (!listItem) return false;
        tr.insert(listEndPos, listItem);
        return true;
      }).run();
    }
  } else {
    // Append bibliography section at end of doc
    editor.chain().focus().command(({ tr, state }) => {
      const endPos = state.doc.content.size;
      const bibHeading = state.schema.nodes.paragraph?.create(
        {},
        state.schema.text("Bibliography"),
      );
      const listItemContent = state.schema.nodes.paragraph?.create(
        {},
        state.schema.text(bibEntry),
      );
      const listItem = state.schema.nodes.listItem?.createAndFill({}, listItemContent);
      const orderedList = state.schema.nodes.orderedList?.createAndFill({}, listItem ? [listItem] : []);
      if (!bibHeading || !orderedList) return false;
      tr.insert(endPos, [bibHeading, orderedList]);
      return true;
    }).run();
  }
}
