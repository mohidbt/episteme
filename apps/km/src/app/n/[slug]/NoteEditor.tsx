"use client";
import { Editor } from "@episteme/editor";
import { useCallback, useRef } from "react";

export function NoteEditor({ id, initialMd }: { id: string; initialMd: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeMd = useCallback(
    (md: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        fetch(`/api/notes/${id}/content`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contentMd: md }),
        });
      }, 800);
    },
    [id],
  );
  return <Editor initialMd={initialMd} onChangeMd={onChangeMd} autofocus />;
}
