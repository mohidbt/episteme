import Placeholder from "@tiptap/extension-placeholder";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { createExtensions as baseExtensions, WikiLink, TagMark } from "@episteme/markdown";

export type WikiLinkSuggestion = Omit<SuggestionOptions, "editor" | "pluginKey">;

export function editorExtensions(opts?: {
  placeholder?: string;
  wikiLinkSuggestion?: WikiLinkSuggestion;
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

  return [
    ...baseExtensions(),
    wikiLink,
    TagMark,
    Placeholder.configure({ placeholder: opts?.placeholder ?? "Start writing…" }),
  ];
}
