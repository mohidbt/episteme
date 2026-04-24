import Placeholder from "@tiptap/extension-placeholder";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { createExtensions as baseExtensions, WikiLink, TagMark } from "@episteme/markdown";

export type WikiLinkSuggestion = Omit<SuggestionOptions, "editor" | "pluginKey">;

export const SlashCommandPluginKey = new PluginKey("slashCommand");

export const SlashCommand = Extension.create({
  name: "slashCommand",
});

export type SlashCommandSuggestion = Omit<SuggestionOptions, "editor" | "pluginKey">;

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
            }),
          ];
        },
      })
    : null;

  return [
    ...baseExtensions(),
    wikiLink,
    TagMark,
    Placeholder.configure({ placeholder: opts?.placeholder ?? "Start writing…" }),
    ...(slashCommand ? [slashCommand] : []),
  ];
}