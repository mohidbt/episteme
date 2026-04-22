"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ResolvedLinksMap } from "@episteme/editor";
import { NoteEditor } from "./NoteEditor";
import { VersionDrawer } from "@/components/VersionDrawer";

export function NotePageClient({
  id,
  title,
  initialMd,
  resolvedLinks,
}: {
  id: string;
  title: string;
  initialMd: string;
  resolvedLinks?: ResolvedLinksMap;
}) {
  const router = useRouter();
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  const onBeforeRestore = useCallback(async () => {
    // Flush any pending autosave BEFORE the restore POST so its PATCH cannot
    // race the restore and clobber it.
    await flushRef.current?.();
  }, []);

  const onAfterRestore = useCallback(() => {
    // Refetch server props -> NoteEditor re-mounts with fresh initialMd.
    router.refresh();
  }, [router]);

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold" data-testid="note-title">
          {title}
        </h1>
        <VersionDrawer
          noteId={id}
          currentMd={initialMd}
          onBeforeRestore={onBeforeRestore}
          onAfterRestore={onAfterRestore}
        />
      </div>
      <NoteEditor
        id={id}
        initialMd={initialMd}
        resolvedLinks={resolvedLinks}
        flushRef={flushRef}
      />
    </>
  );
}
