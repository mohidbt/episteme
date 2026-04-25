"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ResolvedLinksMap, TiptapEditor } from "@episteme/editor";
import { NoteEditor } from "./NoteEditor";
import { VersionDrawer } from "@/components/VersionDrawer";
import { SummarizeAction } from "@/components/SummarizeAction";
import { AskNotesPanel } from "@/components/AskNotesPanel";
import { PublishDialog } from "@/components/PublishDialog";
import { DownloadButton } from "@/components/DownloadButton";

export function NotePageClient({
  id,
  title,
  initialMd,
  resolvedLinks,
  initialUsername,
  initialIsPublic,
  initialPublicSlug,
  noteSlug,
}: {
  id: string;
  title: string;
  initialMd: string;
  resolvedLinks?: ResolvedLinksMap;
  initialUsername: string | null;
  initialIsPublic: boolean;
  initialPublicSlug: string | null;
  noteSlug: string;
}) {
  const router = useRouter();
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const editorRef = useRef<TiptapEditor | null>(null);

  const onBeforeRestore = useCallback(async () => {
    // Flush any pending autosave BEFORE the restore POST so its PATCH cannot
    // race the restore and clobber it.
    await flushRef.current?.();
  }, []);

  const onAfterRestore = useCallback(() => {
    // Refetch server props -> NoteEditor re-mounts with fresh initialMd.
    router.refresh();
  }, [router]);

  const onBeforeInsert = useCallback(async () => {
    await flushRef.current?.();
  }, []);

  const onAfterInsert = useCallback(() => {
    router.refresh();
  }, [router]);

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold" data-testid="note-title">
          {title}
        </h1>
        <div className="flex items-center gap-1">
          <AskNotesPanel />
          <SummarizeAction
            noteId={id}
            contentMd={initialMd}
            onBeforeInsert={onBeforeInsert}
            onAfterInsert={onAfterInsert}
          />
          <PublishDialog
            noteId={id}
            initialUsername={initialUsername}
            initialIsPublic={initialIsPublic}
            initialPublicSlug={initialPublicSlug}
            defaultSlug={noteSlug}
          />
          <VersionDrawer
            noteId={id}
            currentMd={initialMd}
            onBeforeRestore={onBeforeRestore}
            onAfterRestore={onAfterRestore}
          />
          <DownloadButton
            slug={noteSlug}
            getMarkdown={() => {
              const editor = editorRef.current;
              if (editor?.storage?.markdown?.getMarkdown) {
                return editor.storage.markdown.getMarkdown() as string;
              }
              return initialMd;
            }}
          />
        </div>
      </div>
      <NoteEditor
        id={id}
        initialMd={initialMd}
        resolvedLinks={resolvedLinks}
        flushRef={flushRef}
        editorRef={editorRef}
      />
    </>
  );
}
