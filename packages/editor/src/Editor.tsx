"use client";

import { type ReactNode, useEffect } from "react";
import { useEditor, EditorContent, type Editor as TiptapEditor } from "@tiptap/react";
import {
  editorExtensions,
  type WikiLinkSuggestion,
  type SlashCommandSuggestion,
  type CollabOptions,
} from "./extensions";
import { hydrateWikiLinkResolutions, type ResolvedLinksMap } from "./hydrate-wiki-links";
import "./styles.css";

export interface EditorProps {
  initialMd: string;
  onChangeMd: (md: string) => void;
  placeholder?: string;
  autofocus?: boolean;
  wikiLinkSuggestion?: WikiLinkSuggestion;
  slashCommandSuggestion?: SlashCommandSuggestion;
  resolvedLinks?: ResolvedLinksMap;
  onReady?: (editor: TiptapEditor) => void;
  children?: ReactNode;
  collab?: CollabOptions;
}

export function Editor({
  initialMd,
  onChangeMd,
  placeholder,
  autofocus,
  wikiLinkSuggestion,
  slashCommandSuggestion,
  resolvedLinks,
  onReady,
  children,
  collab,
}: EditorProps) {
  // Pass collab?.ydoc as a dep so useEditor destroys and recreates the editor
  // whenever the ydoc identity changes (i.e. when navigating to a different note
  // without unmounting this component). Without this dep, Tiptap's
  // EditorInstanceManager takes the deps===[] fast-path (setOptions only) and
  // the Collaboration extension stays bound to the old ydoc forever.
  const editor = useEditor(
    {
      extensions: editorExtensions({
        placeholder,
        wikiLinkSuggestion,
        slashCommandSuggestion,
        collab,
      }),
      // When collab is active, Collaboration hydrates from the Y.Doc — do not
      // seed content here or it will race the provider's initial state.
      content: collab ? undefined : initialMd,
      autofocus: autofocus ?? false,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "episteme-prose outline-none min-h-[60vh]",
        },
      },
      onUpdate: ({ editor }) => {
        if (collab) return; // Hocuspocus owns persistence — skip client autosave
        const md = (editor.storage as any).markdown.getMarkdown() as string;
        onChangeMd(md);
      },
    },
    // Recreate editor when the ydoc changes (different note) or collab is
    // toggled on/off. Using the ydoc object reference means a new note always
    // gets a fresh editor with the correct Collaboration binding.
    [collab?.ydoc],
  );

  useEffect(() => {
    if (collab) return; // Collaboration owns doc state — skip setContent echo
    if (!editor) return;
    if (editor.isFocused) return;
    const currentMd = (editor.storage as any).markdown.getMarkdown() as string;
    if (currentMd === initialMd) return;
    editor.commands.setContent(initialMd, false);
  }, [initialMd, editor, collab]);

  useEffect(() => {
    if (!editor || !resolvedLinks) return;
    hydrateWikiLinkResolutions(editor, resolvedLinks);
  }, [editor, resolvedLinks]);

  useEffect(() => {
    if (!editor || !onReady) return;
    onReady(editor);
  }, [editor, onReady]);

  return (
    <>
      <EditorContent editor={editor} />
      {children}
    </>
  );
}