"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { editorExtensions, type WikiLinkSuggestion } from "./extensions";
import "./styles.css";

export interface EditorProps {
  initialMd: string;
  onChangeMd: (md: string) => void;
  placeholder?: string;
  autofocus?: boolean;
  wikiLinkSuggestion?: WikiLinkSuggestion;
}

export function Editor({
  initialMd,
  onChangeMd,
  placeholder,
  autofocus,
  wikiLinkSuggestion,
}: EditorProps) {
  const editor = useEditor({
    extensions: editorExtensions({ placeholder, wikiLinkSuggestion }),
    content: initialMd,
    autofocus: autofocus ?? false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "episteme-prose outline-none min-h-[60vh]",
      },
    },
    onUpdate: ({ editor }) => {
      const md = (editor.storage as any).markdown.getMarkdown() as string;
      onChangeMd(md);
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (editor.isFocused) return;
    const currentMd = (editor.storage as any).markdown.getMarkdown() as string;
    if (currentMd === initialMd) return;
    editor.commands.setContent(initialMd, false);
  }, [initialMd, editor]);

  return <EditorContent editor={editor} />;
}
