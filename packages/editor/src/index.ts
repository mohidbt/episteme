export { Editor } from "./Editor";
export type { EditorProps } from "./Editor";
export { BubbleMenu } from "@tiptap/react";
export type { Editor as TiptapEditor } from "@tiptap/react";
export { editorExtensions, SlashCommand, SlashCommandPluginKey, userColor, buildCursorElement, isInsideCodeBlock, isPrecededByBackslash } from "./extensions";
export type { WikiLinkSuggestion, SlashCommandSuggestion, CollabOptions, FileUploadOptions } from "./extensions";
export { CollapsibleHeading, CollapsibleHeadingPluginKey } from "./collapsible-heading";
export { hydrateWikiLinkResolutions, attachWikiLinkRehydration } from "./hydrate-wiki-links";
export type { ResolvedLinksMap, WikiLinkResolution } from "./hydrate-wiki-links";
export { createCollabProvider } from "./collab";
export type { CollabProvider, CollabProviderArgs } from "./collab";
export { parseSlashCommand, insertCitation, insertWikiLink, invokeAgent, renumberCitations, hydrateCitations } from "./slash/index";
export type { ParsedSlashCommand, CiteCommandPayload, LinkCommandPayload, AgentCommandPayload, CitationMeta } from "./slash/index";
export { BibliographyHeading } from "./slash/BibliographyHeading";
export { MdPaste } from "./MdPaste";
export {
  chatEditorExtensions,
  serializeChatDoc,
  isChatDocEmpty,
} from "./chat-editor";
export type { ChatWikiLinkSuggestion, ChatExtensionOptions } from "./chat-editor";
export { useEditor, EditorContent } from "@tiptap/react";
