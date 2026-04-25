import Placeholder from "@tiptap/extension-placeholder";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { createExtensions as baseExtensions, WikiLink, TagMark, Citation } from "@episteme/markdown";
import { BibliographyHeading } from "./slash/BibliographyHeading";
import { MdPaste } from "./MdPaste";

export type WikiLinkSuggestion = Omit<SuggestionOptions, "editor" | "pluginKey">;

export const SlashCommandPluginKey = new PluginKey("slashCommand");

export const SlashCommand = Extension.create({
  name: "slashCommand",
});

export type SlashCommandSuggestion = Omit<SuggestionOptions, "editor" | "pluginKey" | "allow">;

/**
 * Returns true when the cursor is inside a `code_block` node.
 * Used by the slash-command Suggestion `allow` predicate to suppress the menu
 * inside code fences.
 */
export function isInsideCodeBlock(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === "codeBlock") return true;
  }
  return false;
}

/**
 * Returns true when the character immediately before the cursor is `\`.
 * Used by the slash-command Suggestion `allow` predicate so that `\/cite`
 * is treated as literal text rather than a slash command trigger.
 */
export function isPrecededByBackslash(state: EditorState): boolean {
  const { $from } = state.selection;
  const textBefore = $from.nodeBefore?.text ?? "";
  return textBefore.endsWith("\\");
}

export function editorExtensions(opts?: {
  placeholder?: string;
  wikiLinkSuggestion?: WikiLinkSuggestion;
  slashCommandSuggestion?: SlashCommandSuggestion;
}) {
  const wikiLink = opts?.wikiLinkSuggestion
    ? WikiLink.extend({
        addProseMirrorPlugins() {
          return [
            Suggestion({
              ...opts.wikiLinkSuggestion,
              editor: this.editor,
              char: "[[",
            }),
          ];
        },
      })
    : WikiLink;

  const slashCommand = opts?.slashCommandSuggestion
    ? SlashCommand.extend({
        addProseMirrorPlugins() {
          return [
            Suggestion({
              ...opts.slashCommandSuggestion,
              editor: this.editor,
              pluginKey: SlashCommandPluginKey,
              char: "/",
              // Non-overrideable regression locks: suppress inside code blocks
              // and after backslash escape. Type omits `allow` from
              // SlashCommandSuggestion so callers cannot bypass these.
              allow: ({ state }) =>
                !isInsideCodeBlock(state) && !isPrecededByBackslash(state),
            }),
          ];
        },
      })
    : null;

  return [
    ...baseExtensions(),
    wikiLink,
    TagMark,
    BibliographyHeading,
    Placeholder.configure({ placeholder: opts?.placeholder ?? "Start writing…" }),
    ...(slashCommand ? [slashCommand] : []),
    MdPaste,
  ];
}