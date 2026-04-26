import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { CitationAttrs } from "@episteme/markdown";

export interface CitationMeta {
  citekey: string;
  title: string;
  authors: string[];
  year: string | null;
  doi: string | null;
}

/**
 * Walk the doc in order and assign bibIndex 1..N to every citation node.
 * Idempotent — running twice produces the same result.
 *
 * Returns true if any citation was updated, false if doc was unchanged.
 */
export function renumberCitations(editor: Editor): boolean {
  let index = 0;
  const updates: Array<{ pos: number; attrs: CitationAttrs }> = [];

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "citation") {
      index++;
      const current = node.attrs as CitationAttrs;
      if (current.bibIndex !== index) {
        updates.push({ pos, attrs: { ...current, bibIndex: index } });
      }
    }
  });

  if (updates.length === 0) return false;

  editor.chain().command(({ tr, state }) => {
    for (const { pos, attrs } of updates) {
      const node = state.doc.nodeAt(pos);
      if (node?.type.name === "citation") {
        tr.setNodeMarkup(pos, undefined, attrs);
      }
    }
    return true;
  }).run();

  return true;
}

/**
 * Hydrate citations on note load (Defects B, C, D):
 *
 * 1. Collect all citekeys present in the doc.
 * 2. Fetch fresh metadata from the caller-supplied fetcher (DI for testability).
 * 3. Patch citation node attrs with fetched title/authors/year.
 * 4. Assign bibIndex 1..N in document order.
 * 5. Rebuild the bibliography ordered list to reflect the current citation set
 *    with fresh metadata.
 * 6. Upgrade a plain "Bibliography" paragraph to a bibliographyHeading node
 *    so within-session dedup works post-load.
 *
 * If the doc has zero citations → no-op (fetcher not called).
 * If doc has citations but no bibliography section → insert one (edge case).
 * If doc has bibliography but zero citations → leave unchanged.
 */
export async function hydrateCitations(
  editor: Editor,
  fetcher: (citekeys: string[]) => Promise<CitationMeta[]>,
): Promise<void> {
  // 1. Collect citekeys in document order
  const citationsInOrder: Array<{ pos: number; attrs: CitationAttrs }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "citation") {
      citationsInOrder.push({ pos, attrs: node.attrs as CitationAttrs });
    }
  });

  if (citationsInOrder.length === 0) return;

  const citekeys = citationsInOrder.map((c) => c.attrs.citekey);

  // 2. Fetch metadata for all citekeys
  const fetched = await fetcher(citekeys);
  const metaByKey = new Map<string, CitationMeta>(fetched.map((m) => [m.citekey, m]));

  // 3+4. Patch citation attrs and assign bibIndex in one transaction
  // 5+6. Rebuild bibliography list
  editor.chain().command(({ tr, state }) => {
    const schema = state.schema;

    // --- Patch each citation node ---
    let bibIndex = 1;
    for (const { pos, attrs } of citationsInOrder) {
      const node = state.doc.nodeAt(pos);
      if (!node || node.type.name !== "citation") continue;
      const meta = metaByKey.get(attrs.citekey);
      const newAttrs: CitationAttrs = {
        citekey: attrs.citekey,
        title: meta?.title ?? attrs.title,
        authors: meta?.authors ?? attrs.authors,
        year: meta?.year ?? attrs.year,
        bibIndex,
      };
      tr.setNodeMarkup(pos, undefined, newAttrs);
      bibIndex++;
    }

    // --- Rebuild bibliography section ---
    // Locate existing bibliography heading + ordered list
    const doc = state.doc;
    let bibHeadingPos = -1;
    let bibHeadingNodeSize = 0;
    let bibHeadingTypeName = "";
    let bibListPos = -1;
    let bibListNodeSize = 0;

    doc.forEach((node, pos) => {
      if (bibHeadingPos !== -1 && bibListPos === -1) {
        // Next block after bibliography heading
        if (node.type.name === "orderedList") {
          bibListPos = pos;
          bibListNodeSize = node.nodeSize;
        }
        return;
      }
      if (node.type.name === "bibliographyHeading") {
        bibHeadingPos = pos;
        bibHeadingNodeSize = node.nodeSize;
        bibHeadingTypeName = node.type.name;
        return;
      }
      if (node.type.name === "paragraph") {
        const text = node.textContent;
        if (text === "Bibliography" || text.startsWith("Bibliography")) {
          bibHeadingPos = pos;
          bibHeadingNodeSize = node.nodeSize;
          bibHeadingTypeName = node.type.name;
        }
      }
    });

    // Build fresh bibliography list items (one per citation in order)
    const listItems = citationsInOrder.map(({ attrs }, i) => {
      const meta = metaByKey.get(attrs.citekey);
      const resolvedAttrs: CitationAttrs = {
        citekey: attrs.citekey,
        title: meta?.title ?? attrs.title ?? "",
        authors: meta?.authors ?? attrs.authors ?? [],
        year: meta?.year ?? attrs.year,
        bibIndex: i + 1,
      };
      const title = resolvedAttrs.title ?? resolvedAttrs.citekey;
      const authorsArr = (resolvedAttrs.authors ?? []) as string[];
      const authorsStr =
        authorsArr.slice(0, 3).join(", ") + (authorsArr.length > 3 ? " et al." : "");
      const bibText = resolvedAttrs.year
        ? `${authorsStr} (${resolvedAttrs.year}). ${title}.`
        : `${authorsStr}. ${title}.`;
      const para = schema.nodes.paragraph?.create({}, schema.text(bibText));
      return schema.nodes.listItem?.createAndFill({}, para);
    }).filter(Boolean) as PmNode[];

    const newOrderedList = schema.nodes.orderedList?.createAndFill({}, listItems);
    if (!newOrderedList) return false;

    if (bibHeadingPos !== -1) {
      // Upgrade plain paragraph to bibliographyHeading if needed
      if (bibHeadingTypeName !== "bibliographyHeading") {
        const bibHeadingType = schema.nodes.bibliographyHeading ?? schema.nodes.paragraph;
        const newHeading = bibHeadingType?.create({}, schema.text("Bibliography"));
        if (newHeading) {
          tr.replaceWith(bibHeadingPos, bibHeadingPos + bibHeadingNodeSize, newHeading);
          // bibliographyHeading has same nodeSize as the "Bibliography" paragraph it replaces,
          // so bibListPos is still valid after this replacement.
        }
      }

      // Replace or insert the ordered list
      if (bibListPos !== -1) {
        // Replace existing list with fresh one
        tr.replaceWith(bibListPos, bibListPos + bibListNodeSize, newOrderedList);
      } else {
        // Heading exists but no list — insert after heading
        tr.insert(bibHeadingPos + bibHeadingNodeSize, newOrderedList);
      }
    } else {
      // No bibliography section exists — insert at end of doc
      const bibHeadingType = schema.nodes.bibliographyHeading ?? schema.nodes.paragraph;
      const newHeading = bibHeadingType?.create({}, schema.text("Bibliography"));
      if (newHeading) {
        tr.insert(doc.content.size, [newHeading, newOrderedList]);
      }
    }

    // Preserve the current selection (hydrate should not move the cursor)
    const selPos = Math.min(state.selection.from, tr.doc.content.size);
    try {
      tr.setSelection(TextSelection.create(tr.doc, selPos));
    } catch {
      // ignore invalid position — selection will map naturally
    }

    return true;
  }).run();
}
