"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ResolvedLinksMap, TiptapEditor } from "@episteme/editor";
import {
  buildMarkdownWithFrontmatter,
  parseFrontmatter,
  type FrontmatterRow,
} from "@episteme/markdown";
import { Check } from "lucide-react";
import { NoteEditor } from "./NoteEditor";
import { NoteFrontmatter } from "@/components/NoteFrontmatter";
import { VersionDrawer } from "@/components/VersionDrawer";
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
  userName,
  initialCollabToken,
}: {
  id: string;
  title: string;
  initialMd: string;
  resolvedLinks?: ResolvedLinksMap;
  initialUsername: string | null;
  initialIsPublic: boolean;
  initialPublicSlug: string | null;
  noteSlug: string;
  userName: string;
  initialCollabToken?: string | null;
}) {
  const router = useRouter();
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const editorRef = useRef<TiptapEditor | null>(null);
  const initialParsed = useMemo(
    () => parseFrontmatter(initialMd),
    [initialMd],
  );
  const [frontmatterRows, setFrontmatterRows] = useState<FrontmatterRow[]>(
    initialParsed.rows,
  );
  const rowsRef = useRef<FrontmatterRow[]>(initialParsed.rows);
  rowsRef.current = frontmatterRows;
  const initialBody = initialParsed.body;

  const transformMd = useCallback(
    (body: string) => buildMarkdownWithFrontmatter(rowsRef.current, body),
    [],
  );

  const onFrontmatterChange = useCallback(
    (next: FrontmatterRow[]) => {
      setFrontmatterRows(next);
      // Persist the combined markdown immediately. We can't depend on the
      // editor's debounced autosave because the editor's body did not change
      // — only the frontmatter prefix did.
      const editor = editorRef.current;
      const body =
        editor?.storage?.markdown?.getMarkdown?.() as string | undefined;
      const combined = buildMarkdownWithFrontmatter(
        next,
        body ?? initialBody,
      );
      void fetch(`/api/notes/${id}/content`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentMd: combined }),
      }).catch((err) => {
        console.warn("[frontmatter autosave] failed", err);
      });
    },
    [id, initialBody],
  );

  const [titleDraft, setTitleDraft] = useState(title);
  const [savingTitle, setSavingTitle] = useState(false);
  const trimmedDraft = titleDraft.trim();
  const titleDirty = trimmedDraft.length > 0 && trimmedDraft !== title;

  const onConfirmTitle = useCallback(async () => {
    if (!titleDirty || savingTitle) return;
    setSavingTitle(true);
    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: trimmedDraft }),
      });
      if (!res.ok) {
        console.warn("[NotePageClient] rename failed", res.status);
        return;
      }
      const row = (await res.json()) as { slug?: string };
      // Slug may have changed — push to the new URL so refresh hits the right note.
      if (row?.slug && row.slug !== noteSlug) {
        router.push(`/n/${encodeURIComponent(row.slug)}`);
      } else {
        router.refresh();
      }
    } finally {
      setSavingTitle(false);
    }
  }, [id, noteSlug, router, savingTitle, titleDirty, trimmedDraft]);

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
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <input
            type="text"
            data-testid="note-title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onConfirmTitle();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setTitleDraft(title);
              }
            }}
            className="text-2xl font-semibold bg-transparent border-0 outline-none focus:ring-0 min-w-0 flex-1 px-0"
            aria-label="Note title"
          />
          {titleDirty ? (
            <button
              type="button"
              data-testid="note-title-confirm"
              onClick={() => void onConfirmTitle()}
              disabled={savingTitle}
              aria-label="Save title"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <AskNotesPanel />
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
              const body = editor?.storage?.markdown?.getMarkdown
                ? (editor.storage.markdown.getMarkdown() as string)
                : initialBody;
              return buildMarkdownWithFrontmatter(rowsRef.current, body);
            }}
          />
        </div>
      </div>
      <NoteFrontmatter
        rows={frontmatterRows}
        onChange={onFrontmatterChange}
      />
      <NoteEditor
        key={id}
        id={id}
        initialMd={initialBody}
        resolvedLinks={resolvedLinks}
        flushRef={flushRef}
        userName={userName}
        initialCollabToken={initialCollabToken}
        editorRef={editorRef}
        transformMd={transformMd}
      />
    </>
  );
}
