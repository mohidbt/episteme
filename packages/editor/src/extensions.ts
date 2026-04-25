import Placeholder from "@tiptap/extension-placeholder";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { createExtensions as baseExtensions, WikiLink, TagMark, Y_PROSEMIRROR_FIELD } from "@episteme/markdown";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import type * as Y from "yjs";
import type { HocuspocusProvider } from "@hocuspocus/provider";

export type WikiLinkSuggestion = Omit<SuggestionOptions, "editor" | "pluginKey">;

export const SlashCommandPluginKey = new PluginKey("slashCommand");

export const SlashCommand = Extension.create({
  name: "slashCommand",
});

export type SlashCommandSuggestion = Omit<SuggestionOptions, "editor" | "pluginKey">;

export interface CollabOptions {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  user: { name: string; color?: string };
}

export function editorExtensions(opts?: {
  placeholder?: string;
  wikiLinkSuggestion?: WikiLinkSuggestion;
  slashCommandSuggestion?: SlashCommandSuggestion;
  collab?: CollabOptions;
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

  const collab = opts?.collab;

  return [
    ...baseExtensions({ collaborative: !!collab }),
    wikiLink,
    TagMark,
    Placeholder.configure({ placeholder: opts?.placeholder ?? "Start writing…" }),
    ...(slashCommand ? [slashCommand] : []),
    ...(collab
      ? [
          Collaboration.configure({ document: collab.ydoc, field: Y_PROSEMIRROR_FIELD }),
          CollaborationCursor.configure({ provider: collab.provider, user: collab.user }),
        ]
      : []),
  ];
}