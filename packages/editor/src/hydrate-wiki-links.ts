import type { Editor } from "@tiptap/core";

export type WikiLinkResolution = {
  targetKind: "note" | "reference" | "paper";
  targetId: string | null;
};

export type ResolvedLinksMap = Record<string, WikiLinkResolution>;

/**
 * Walk all `wikiLink` nodes in the editor doc and fill in `targetKind` /
 * `targetId` attrs from the given map (keyed by lowercased title). Dispatches
 * a single transaction flagged `addToHistory: false` so hydration does not
 * pollute the undo stack.
 *
 * Returns `true` if any node was updated, `false` otherwise.
 */
export function hydrateWikiLinkResolutions(
  editor: Editor,
  resolvedLinks: ResolvedLinksMap,
): boolean {
  const { state } = editor;
  const tr = state.tr;
  let touched = false;

  state.doc.descendants((node, pos) => {
    if (node.type.name !== "wikiLink") return;
    const title = typeof node.attrs.title === "string" ? node.attrs.title : "";
    if (!title) return;
    const hit = resolvedLinks[title.toLowerCase()];
    if (!hit || !hit.targetId) return;
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      targetKind: hit.targetKind,
      targetId: hit.targetId,
    });
    touched = true;
  });

  if (touched) editor.view.dispatch(tr.setMeta("addToHistory", false));
  return touched;
}
