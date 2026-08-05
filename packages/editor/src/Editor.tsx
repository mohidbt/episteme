"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { useEditor, EditorContent, type Editor as TiptapEditor } from "@tiptap/react";
import { attachEditorKeyIsolation } from "./key-isolation";
import {
  editorExtensions,
  type WikiLinkSuggestion,
  type SlashCommandSuggestion,
  type CollabOptions,
  type FileUploadOptions,
} from "./extensions";
import {
  hydrateWikiLinkResolutions,
  attachWikiLinkRehydration,
  type ResolvedLinksMap,
} from "./hydrate-wiki-links";
import "katex/dist/katex.min.css";
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
  fileUpload?: FileUploadOptions;
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
  fileUpload,
}: EditorProps) {
  // Editor lifecycle is owned by the parent via `key` (e.g. key={noteId} on
  // NoteEditor remounts everything on navigation). Within a single mount we
  // assume `collab` is stable — callers must not flip it from undefined → set
  // mid-life or Tiptap's setOptions fast-path will keep Collaboration bound to
  // the wrong ydoc. Gate rendering on token-readiness in the parent.
  const editor = useEditor({
    extensions: editorExtensions({
      placeholder,
      wikiLinkSuggestion,
      slashCommandSuggestion,
      collab,
      fileUpload,
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
  });

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
    // First pass: hydrate against whatever the doc has right now. In non-collab
    // mode this is the seeded markdown; in collab mode the doc is usually
    // still empty here because the YJS provider hasn't synced yet.
    hydrateWikiLinkResolutions(editor, resolvedLinks);
    // Re-fire when the provider's initial sync completes and on later YJS
    // updates — covers wikiLink nodes that materialize from Y.Doc after the
    // mount-time effect already ran with targetId=null. (N6 fix.)
    if (!collab) return;
    return attachWikiLinkRehydration(editor, resolvedLinks, {
      provider: collab.provider as never,
      ydoc: collab.ydoc as never,
    });
    // N6 fix: depend on the stable inner refs, not the `collab` object — parents
    // sometimes recreate `{ provider, ydoc, user }` per render, which would
    // detach/reattach the YJS listener and clear the debounce timer needlessly.
  }, [editor, resolvedLinks, collab?.provider, collab?.ydoc]);

  useEffect(() => {
    if (!editor || !onReady) return;
    onReady(editor);
  }, [editor, onReady]);

  // GSD-84 — keep plain-letter keystrokes (e.g. "g") from bubbling out of the
  // editor to window-level hotkey listeners that would otherwise hijack typing.
  const isolationHostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = isolationHostRef.current;
    if (!host) return;
    return attachEditorKeyIsolation(host);
  }, []);

  return (
    <div ref={isolationHostRef} style={{ display: "contents" }}>
      <EditorContent editor={editor} />
      {children}
    </div>
  );
}