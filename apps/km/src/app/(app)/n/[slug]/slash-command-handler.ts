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
 * Fix: defer the AI trigger increment via `queueMicrotask` so the suggestion
 * plugin's dispatch completes before React begins re-rendering the editor
 * subtree.
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
   * Schedules a callback to run after the current synchronous work
   * completes. Defaults to `queueMicrotask`; overridable for tests.
   */
  defer?: (fn: () => void) => void;
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
  const defer = deps.defer ?? queueMicrotask;

  // Delete the `/` trigger and any typed query characters first so the
  // Suggestion plugin sees the trigger char is gone and finishes its
  // decoration teardown in the same view update.
  editor.chain().focus().deleteRange(range).run();

  if (props.title === "AI") {
    // Defer the React state update so the suggestion plugin's view-update
    // cycle completes before the parent re-renders. Synchronously firing
    // setState here races ProseMirror's DOM reconciliation and surfaces as
    // a `Failed to execute 'insertBefore' on 'Node'` crash.
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
