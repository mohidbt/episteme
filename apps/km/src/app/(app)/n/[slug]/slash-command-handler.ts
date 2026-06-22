/**
 * GSD-134 — Slash command dispatch helper extracted from NoteEditor.
 *
 * Centralizes the `command` callback used by the Tiptap Suggestion plugin so
 * its side-effects (in particular the AI portal trigger) can be tested in
 * isolation.
 *
 * Crash background: clicking the "AI" slash item crashed with
 * `NotFoundError: Failed to execute 'insertBefore' on 'Node'`. The STRUCTURAL
 * root cause (iteration 3) was that the AI-rephrase panel rendered as a React
 * sibling of `<BubbleMenu>`, whose underlying div is `.remove()`'d and reparented
 * into a tippy popper by `@tiptap/extension-bubble-menu`. React's commit-phase
 * placement then tried to `insertBefore` the panel against that relocated div,
 * which is no longer a child of the expected parent. The fix lives in
 * `AiBubbleMenu.tsx`: the panel is now `createPortal`'d into `document.body`.
 *
 * Two earlier iterations deferred this `onAiTrigger` state update — first via
 * `queueMicrotask` (iteration 1), then via a double `requestAnimationFrame`
 * (iteration 2). Both still crashed on preview, because the broken sibling
 * relationship is invalid regardless of WHEN the state update lands. With the
 * panel body-portaled, the trigger fires synchronously — no defer needed.
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

  // Delete the `/` trigger and any typed query characters first so the
  // Suggestion plugin sees the trigger char is gone and finishes its
  // decoration teardown in the same view update.
  editor.chain().focus().deleteRange(range).run();

  if (props.title === "AI") {
    // Fire synchronously: the AI-rephrase panel is body-portaled (see
    // AiBubbleMenu.tsx), so this state update no longer races a sibling DOM
    // insertion against the tippy-relocated BubbleMenu div. No defer needed.
    deps.onAiTrigger();
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
