/**
 * GSD-134 — Slash command dispatch helper extracted from NoteEditor.
 *
 * Centralizes the `command` callback used by the Tiptap Suggestion plugin so
 * its side-effects (in particular the AI portal trigger) can be tested in
 * isolation.
 *
 * Crash background: clicking the "AI" slash item used to dispatch the
 * editor's `deleteRange` transaction and the React `setAiTriggerCount` state
 * update **synchronously** inside the suggestion plugin's command callback.
 * That fired a parent re-render mid-dispatch — the `AiBubbleMenu` effect
 * then called `editor.view.coordsAtPos(...)` and `editor.commands.focus()`
 * while ProseMirror's view was still applying the suggestion plugin's
 * decoration update. The DOM mutation race surfaced as
 * `NotFoundError: Failed to execute 'insertBefore' on 'Node'`.
 *
 * Iteration 1 deferred via `queueMicrotask` — this was proven INSUFFICIENT on
 * preview: the crash still reproduced. A microtask runs inside the SAME
 * microtask checkpoint as ProseMirror's MutationObserver flush + the
 * suggestion plugin's async `onExit` teardown + React reconciliation, all
 * before the browser commits a stable layout. The editor DOM is still in flux
 * when the deferred state update lands.
 *
 * Iteration 2 fix: defer via a double `requestAnimationFrame`. The first RAF
 * fires just before the next paint — after the current microtask checkpoint
 * fully drains (ProseMirror's view + MutationObserver settled, the slash
 * typeahead root unmounted). The nested second RAF pushes the React state
 * update past that paint so the `AiBubbleMenu` effect's `coordsAtPos` / focus
 * reads run against a fully settled editor DOM. `defer` stays overridable for
 * tests.
 */

import type { TiptapEditor } from "@episteme/editor";
import { insertCitation, insertWikiLink, invokeAgent } from "@episteme/editor";

export interface SlashCommandPayload {
  title: string;
  citation?: {
    citekey: string;
    title: string;
    authors: string[];
    year: string | null;
  };
  wikiLink?: {
    title: string;
    targetKind: "note" | "reference" | "paper";
    targetId: string | null;
  };
  agent?: { skill: string };
}

export interface SlashCommandHandlerDeps {
  /** Increments the AI portal trigger counter on the parent component. */
  onAiTrigger: () => void;
  /**
   * Schedules a callback to run after the editor's view has fully settled.
   * Defaults to a double `requestAnimationFrame` (fires past the next paint);
   * overridable for tests. A microtask is NOT enough — see file header.
   */
  defer?: (fn: () => void) => void;
}

/**
 * Defer past the next browser paint via nested `requestAnimationFrame`. The
 * outer frame fires after the current microtask checkpoint drains; the inner
 * frame fires after that paint, by which point ProseMirror's view + React's
 * reconciliation have settled. Falls back to `queueMicrotask` in non-DOM
 * environments (e.g. SSR) where `requestAnimationFrame` is unavailable.
 */
function rafDefer(fn: () => void): void {
  if (typeof requestAnimationFrame !== "function") {
    queueMicrotask(fn);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

export interface SlashCommandHandlerArgs {
  editor: TiptapEditor;
  range: { from: number; to: number };
  props: SlashCommandPayload;
}

export function handleSlashCommand(
  args: SlashCommandHandlerArgs,
  deps: SlashCommandHandlerDeps,
): void {
  const { editor, range, props } = args;
  const defer = deps.defer ?? rafDefer;

  // Delete the `/` trigger and any typed query characters first so the
  // Suggestion plugin sees the trigger char is gone and finishes its
  // decoration teardown in the same view update.
  editor.chain().focus().deleteRange(range).run();

  if (props.title === "AI") {
    // Defer the React state update past the next paint (double RAF) so the
    // suggestion plugin's async teardown + ProseMirror's view reconciliation
    // fully settle before the parent re-renders. A microtask was insufficient
    // (iteration 1 still crashed on preview) — it runs inside the same
    // microtask checkpoint as ProseMirror's MutationObserver flush, so the
    // editor DOM is still in flux. Surfaced as a
    // `Failed to execute 'insertBefore' on 'Node'` crash.
    defer(() => deps.onAiTrigger());
    return;
  }

  if (props.title === "Cite" && props.citation) {
    insertCitation(editor, props.citation);
    return;
  }
  if (props.title === "Link" && props.wikiLink) {
    insertWikiLink(editor, props.wikiLink);
    return;
  }
  if (props.title === "Agent" && props.agent) {
    invokeAgent(editor, props.agent);
    return;
  }
  if (props.title === "Table") {
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
    return;
  }
  if (props.title === "Code Block") {
    editor.chain().focus().toggleCodeBlock({ language: "ts" }).run();
    return;
  }
}
