"use client";
import { Editor } from "@episteme/editor";
import { useCallback, useEffect, useRef } from "react";

export function NoteEditor({ id, initialMd }: { id: string; initialMd: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMdRef = useRef<string | null>(null);

  const flush = useCallback(() => {
    const md = pendingMdRef.current;
    if (md == null) return;
    pendingMdRef.current = null;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    fetch(`/api/notes/${id}/content`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentMd: md }),
      keepalive: true,
    }).catch((err) => {
      console.warn("[autosave] failed", err);
    });
  }, [id]);

  const onChangeMd = useCallback(
    (md: string) => {
      pendingMdRef.current = md;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 800);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  return <Editor initialMd={initialMd} onChangeMd={onChangeMd} autofocus />;
}
