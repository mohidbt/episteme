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
  const flushRef = useRef<(() => void) | null>(null);

  const onAfterRestore = useCallback(() => {
    // Flush any pending autosave first so it does not clobber the restore,
    // then have Next refetch server props -> NoteEditor re-mounts with fresh
    // initialMd.
    flushRef.current?.();
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
