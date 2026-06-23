"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Hexagon, BookPlus } from "lucide-react";
import { citationsRefreshEvent } from "./PaperCitationsList";
import {
  TrialExhaustedError,
  fetchOrThrowTrialExhausted,
  surfaceTrialExhaustedToast,
  maybeNotifyUsageThreshold,
} from "@/lib/trial-exhausted";

interface Paper {
  id: string;
  title: string | null;
  doi: string | null;
  libraryId: number | null;
  folderPath: string;
}

export function PaperActionsButtons({
  paper,
  hasCitations = false,
  alreadyReferenced = false,
}: {
  paper: Paper;
  hasCitations?: boolean;
  /** GSD-8: paper is already linked as a reference in the library — disable
   * the "Add as reference" button (avoids the duplicate flow + 409 noise). */
  alreadyReferenced?: boolean;
}) {
  const router = useRouter();
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);

  async function onFindCitations() {
    if (extracting || hasCitations) return;
    setExtracting(true);
    try {
      const res = await fetchOrThrowTrialExhausted(
        `/api/papers/${paper.id}/citations/extract`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      if (!res.ok) {
        toast.error("Citation extraction failed", { description: `HTTP ${res.status}` });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        unavailable?: boolean;
        alreadyExtracted?: boolean;
        stats?: { referencesInserted?: number; extractionMethod?: string };
      };
      if (data?.unavailable) {
        toast.error("Citation extraction service is unavailable. Please try again later.");
        return;
      }
      // GSD-139: only nudge on a real LLM/S2 burn. The cached branch
      // (alreadyExtracted) bills nothing, so skip the spend check there.
      if (!data.alreadyExtracted && data.stats?.extractionMethod !== "cached") {
        void maybeNotifyUsageThreshold();
      }
      const n = data.stats?.referencesInserted ?? 0;
      toast.success(n > 0 ? `Found ${n} citation${n === 1 ? "" : "s"}` : "No citations detected");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(citationsRefreshEvent(paper.id)));
      }
    } catch (err) {
      if (err instanceof TrialExhaustedError) {
        surfaceTrialExhaustedToast();
        return;
      }
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
        disabled={extracting || hasCitations}
        aria-label={hasCitations ? "Citations extracted" : "Find citations"}
        className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground whitespace-nowrap transition-colors hover:bg-muted disabled:opacity-60"
      >
        {extracting ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <Hexagon className="h-3 w-3" aria-hidden />
        )}
        {extracting ? "Finding…" : hasCitations ? "Citations extracted" : "Find citations"}
      </button>
      {showAddAsRef && (
        <button
          type="button"
          onClick={onAddAsReference}
          disabled={saving || alreadyReferenced}
          aria-label="Add as reference"
          title={alreadyReferenced ? "Already linked as a reference in your library" : undefined}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground whitespace-nowrap transition-colors hover:bg-muted disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <BookPlus className="h-3 w-3" aria-hidden />
          )}
          {saving ? "Adding…" : alreadyReferenced ? "Already a reference" : "Add as reference"}
        </button>
      )}
    </>
  );
}
