"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles, BookPlus } from "lucide-react";

interface Paper {
  id: string;
  title: string | null;
  doi: string | null;
  libraryId: number | null;
  folderPath: string;
}

export function PaperActionsButtons({ paper }: { paper: Paper }) {
  const router = useRouter();
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);

  async function onFindCitations() {
    if (extracting) return;
    setExtracting(true);
    try {
      const res = await fetch(`/api/papers/${paper.id}/citations/extract`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        toast.error("Citation extraction failed", { description: `HTTP ${res.status}` });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        unavailable?: boolean;
        stats?: { referencesInserted?: number };
      };
      if (data?.unavailable) {
        toast.error("Citation extraction service is unavailable. Please try again later.");
        return;
      }
      const n = data.stats?.referencesInserted ?? 0;
      toast.success(n > 0 ? `Found ${n} citation${n === 1 ? "" : "s"}` : "No citations detected");
    } catch {
      toast.error("Citation extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  async function onAddAsReference() {
    if (saving || !paper.doi || paper.libraryId == null) return;
    setSaving(true);
    try {
      // BG7: omit folderPath so the server derives folder location from the
      // source paper (paperId). Sending an empty string here would otherwise
      // race-with / override the server-side derivation in some flows.
      const refBody: Record<string, unknown> = {
        doi: paper.doi,
        libraryId: paper.libraryId,
        paperId: paper.id,
      };
      if (paper.folderPath) refBody.folderPath = paper.folderPath;
      const res = await fetch(`/api/references`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(refBody),
      });
      if (res.status === 409) {
        toast.info("Already in your library");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error("Add as reference failed", {
          description: body?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      toast.success("Added to library");
      router.refresh();
    } catch {
      toast.error("Add as reference failed");
    } finally {
      setSaving(false);
    }
  }

  const showAddAsRef = !!paper.doi && paper.libraryId != null;

  return (
    <>
      <button
        type="button"
        onClick={onFindCitations}
        disabled={extracting}
        aria-label="Find citations"
        className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground whitespace-nowrap transition-colors hover:bg-muted disabled:opacity-60"
      >
        {extracting ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-3 w-3" aria-hidden />
        )}
        {extracting ? "Finding…" : "Find citations"}
      </button>
      {showAddAsRef && (
        <button
          type="button"
          onClick={onAddAsReference}
          disabled={saving}
          aria-label="Add as reference"
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground whitespace-nowrap transition-colors hover:bg-muted disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <BookPlus className="h-3 w-3" aria-hidden />
          )}
          {saving ? "Adding…" : "Add as reference"}
        </button>
      )}
    </>
  );
}
