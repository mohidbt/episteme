// GSD-105 (R6 of GSD-96) — minimal Tiptap stack for the chat composer.
//
// The full `editorExtensions()` is too heavy for a single-line chat surface
// (StarterKit, Collaboration, GlobalDragHandle, FileHandler, slash command).
// This module provides a thin stack: Document + Paragraph + Text + HardBreak
// + Placeholder + WikiLink + a `@`-trigger Suggestion.
//
// The serializer walks the doc IN ORDER and emits a flat string with
// `[lib: ...]` tokens interleaved at the exact positions where wikiLink
// atoms sit, so a user prompt "look at @paper then summarise" produces
// `look at [lib: kind=paper id=... title="..."] then summarise`.

import type { Node as PMNode } from "@tiptap/pm/model";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import Placeholder from "@tiptap/extension-placeholder";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { WikiLink, type WikiLinkAttrs } from "@episteme/markdown";

export type ChatWikiLinkSuggestion = Omit<SuggestionOptions, "editor" | "pluginKey">;

export interface ChatExtensionOptions {
  placeholder?: string;
  /** `@`-trigger suggestion. Caller renders the popover + calls
   * `props.command({ title, targetKind, targetId, displayTitle? })`. */
  wikiLinkSuggestion?: ChatWikiLinkSuggestion;
}

/**
 * Build a minimal extension stack for a single-line chat composer.
 *
 * Key bindings (Document level):
 *   - Enter   → submit (host wires via editor.options.editorProps.handleKeyDown)
 *   - Shift+Enter → HardBreak
 *
 * Enter handling lives in the host component, not here, because the host
 * needs to call its own `onSubmit` with the serialized doc. We just make
 * sure HardBreak's default `Shift-Enter` keymap is kept.
 */
export function chatEditorExtensions(opts?: ChatExtensionOptions) {
  const wikiLink = opts?.wikiLinkSuggestion
    ? WikiLink.extend({
        addProseMirrorPlugins() {
          return [
            ...(this.parent?.() ?? []),
            Suggestion({
              ...opts.wikiLinkSuggestion,
              editor: this.editor,
              char: "@",
            }),
          ];
        },
      })
    : WikiLink;

  return [
    Document,
    Paragraph,
    Text,
    HardBreak,
    Placeholder.configure({ placeholder: opts?.placeholder ?? "Ask anything" }),
    wikiLink,
  ];
}

/**
 * Walk the editor doc in DFS order and emit a flat string.
 *
 * - Text nodes are appended verbatim.
 * - wikiLink atoms are replaced by `formatToken({ kind, id, title })`.
 * - HardBreaks become `\n`.
 * - Paragraph boundaries (between paragraphs) also become `\n`.
 */
export function serializeChatDoc(
  doc: PMNode,
  formatToken: (handle: { kind: string; id: string; title: string }) => string,
): string {
  const parts: string[] = [];
  let firstParaSeen = false;

  doc.forEach((paraNode) => {
    if (firstParaSeen) parts.push("\n");
    firstParaSeen = true;
    walk(paraNode, parts, formatToken);
  });

  return parts.join("");
}

function walk(
  node: PMNode,
  out: string[],
  formatToken: (handle: { kind: string; id: string; title: string }) => string,
): void {
  if (node.isText) {
    out.push(node.text ?? "");
    return;
  }
  if (node.type.name === "hardBreak") {
    out.push("\n");
    return;
  }
  if (node.type.name === "wikiLink") {
    const attrs = node.attrs as WikiLinkAttrs;
    const kind = attrs.targetKind ?? "note";
    const id = attrs.targetId ?? "";
    // Prefer the resolved displayTitle, fall back to alias, then title.
    const title = attrs.displayTitle ?? attrs.alias ?? attrs.title ?? "";
    out.push(formatToken({ kind, id, title }));
    return;
  }
  node.forEach((child) => walk(child, out, formatToken));
}

/**
 * Helper to detect whether the doc has any meaningful content. Used by the
 * host to disable the Send button when the doc is effectively empty.
 */
export function isChatDocEmpty(doc: PMNode): boolean {
  let hasContent = false;
  doc.descendants((node) => {
    if (hasContent) return false;
    if (node.isText && (node.text ?? "").trim().length > 0) {
      hasContent = true;
      return false;
    }
    if (node.type.name === "wikiLink") {
      hasContent = true;
      return false;
    }
    return true;
  });
  return !hasContent;
}
