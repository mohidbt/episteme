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
    bibIndex: citationIndex, // stamp immediately; re-numbered later if needed
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

/**
 * Check whether the doc already has a bibliography section.
 * Detection uses the structural `bibliographyHeading` node type (sentinel)
 * rather than plain text matching, so renaming "Bibliography" text won't
 * accidentally create a second block.
 *
 * Falls back to plain-text paragraph detection for sessions where the doc
 * was loaded from serialized markdown (no bibliographyHeading node type on
 * reload — known limitation, documented in BibliographyHeading.ts).
 */
function findBibliographyIndex(
  content: Array<{ type?: string; content?: unknown[] }>,
): number {
  // Primary: structural sentinel node
  const structuralIdx = content.findIndex((n) => n.type === "bibliographyHeading");
  if (structuralIdx !== -1) return structuralIdx;

  // Fallback: plain-text paragraph (for reloaded docs)
  return content.findIndex((node) => {
    if (node.type !== "paragraph") return false;
    const text = (node.content as Array<{ text?: string }> | undefined)
      ?.map((c) => c.text ?? "").join("") ?? "";
    return text.startsWith("Bibliography");
  });
}

function ensureBibliography(editor: Editor, bibEntry: string): void {
  const doc = editor.getJSON();
  const content = doc.content ?? [];

  const bibIdx = findBibliographyIndex(content);

  if (bibIdx !== -1) {
    // Bib section exists — append a list item to the ordered list after it
    const listNode = content[bibIdx + 1];
    if (listNode?.type === "orderedList") {
      editor.chain().focus().command(({ tr, state }) => {
        const docNode = state.doc;
        let listPos = -1;
        // Locate the bibliography ordered list: first orderedList node that
        // immediately follows a bibliographyHeading or a "Bibliography" paragraph.
        docNode.forEach((node, pos) => {
          if (node.type.name !== "orderedList" || listPos !== -1) return;
          const resolvedBefore = docNode.resolve(Math.max(0, pos - 1));
          const beforeNode = resolvedBefore.nodeBefore;
          if (
            beforeNode?.type.name === "bibliographyHeading" ||
            beforeNode?.textContent.startsWith("Bibliography")
          ) {
            listPos = pos;
          }
        });
        if (listPos === -1) return false;
        const list = docNode.nodeAt(listPos);
        if (!list) return false;
        const listEndPos = listPos + list.nodeSize - 1;
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
    // First citation — append a fresh bibliography section at end of doc
    editor.chain().focus().command(({ tr, state }) => {
      const endPos = state.doc.content.size;

      // Prefer the BibliographyHeading custom node; fall back to plain paragraph.
      const bibHeadingType =
        state.schema.nodes.bibliographyHeading ?? state.schema.nodes.paragraph;
      const bibHeading = bibHeadingType?.create(
        {},
        state.schema.text("Bibliography"),
      );

      const listItemContent = state.schema.nodes.paragraph?.create(
        {},
        state.schema.text(bibEntry),
      );
      const listItem = state.schema.nodes.listItem?.createAndFill({}, listItemContent);
      const orderedList = state.schema.nodes.orderedList?.createAndFill(
        {},
        listItem ? [listItem] : [],
      );
      if (!bibHeading || !orderedList) return false;
      tr.insert(endPos, [bibHeading, orderedList]);
      return true;
    }).run();
  }
}
