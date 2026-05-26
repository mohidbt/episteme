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

// Minimal duck-typed shape for on/off so this can accept a HocuspocusProvider
// or a Y.Doc without importing either (keeps this module React-free + light).
type EmitterLike = {
  on: (evt: string, fn: (...args: unknown[]) => void) => void;
  off: (evt: string, fn: (...args: unknown[]) => void) => void;
};

/**
 * Wire late-arriving YJS sync events to re-run `hydrateWikiLinkResolutions`.
 *
 * Why: when collab is active, the editor mounts with an empty doc and the
 * provider syncs from Hocuspocus asynchronously. The React effect that calls
 * `hydrateWikiLinkResolutions` only depends on `[editor, resolvedLinks]` and
 * runs once at mount — before the provider materializes wikiLink nodes from
 * the Y.Doc. The freshly-materialized nodes have `targetId=null`, the pill
 * renders red, and the self-heal plugin (which only fixes `targetKind` from
 * the title prefix) does not restore the id.
 *
 * Listeners attached here re-fire hydration on:
 *   - `provider.on('synced', ...)` — initial Hocuspocus sync completed.
 *   - `ydoc.on('update', ...)` — debounced (~100ms) to catch later updates
 *     where nodes arrive after the first synced event.
 *
 * Returns a cleanup function that detaches both listeners.
 *
 * Idempotent: `hydrateWikiLinkResolutions` is a no-op when no nodes need
 * updating.
 */
export function attachWikiLinkRehydration(
  editor: Editor,
  resolvedLinks: ResolvedLinksMap,
  opts: { provider?: EmitterLike; ydoc?: EmitterLike } = {},
): () => void {
  const run = () => {
    if (editor.isDestroyed) return;
    hydrateWikiLinkResolutions(editor, resolvedLinks);
  };

  const { provider, ydoc } = opts;
  const onSynced = () => run();

  let debounceHandle: ReturnType<typeof setTimeout> | null = null;
  const onUpdate = () => {
    if (debounceHandle !== null) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      debounceHandle = null;
      run();
    }, 100);
  };

  provider?.on("synced", onSynced as (...args: unknown[]) => void);
  ydoc?.on("update", onUpdate as (...args: unknown[]) => void);

  return () => {
    provider?.off("synced", onSynced as (...args: unknown[]) => void);
    ydoc?.off("update", onUpdate as (...args: unknown[]) => void);
    if (debounceHandle !== null) clearTimeout(debounceHandle);
  };
}
