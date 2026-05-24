import type { Editor } from "@tiptap/core";

export type WikiLinkResolution = {
  targetKind: "note" | "reference" | "paper";
  targetId: string | null;
  // Slug is carried only for note targets so the UI can route to `/n/<slug>`
  // without a separate id→slug fetch.
  targetSlug?: string | null;
};

export type ResolvedLinksMap = Record<string, WikiLinkResolution>;

/**
 * Walk all `wikiLink` nodes in the editor doc and fill in `targetKind` /
 * `targetId` attrs from the given map. Dispatches a single transaction flagged
 * `addToHistory: false` so hydration does not pollute the undo stack.
 *
 * Lookup keys are kind-qualified — `${kind}::${title.toLowerCase()}` — when
 * the node carries a known `targetKind` (set by the K6 prefix classifier on
 * ingress). Falls back to bare-title key for backward compatibility with
 * notes saved before the classifier landed (`targetKind=null`).
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
    const kind = node.attrs.targetKind as
      | "note"
      | "reference"
      | "paper"
      | null
      | undefined;
    const lower = title.toLowerCase();
    const hit =
      (kind ? resolvedLinks[`${kind}::${lower}`] : undefined) ??
      resolvedLinks[lower];
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
