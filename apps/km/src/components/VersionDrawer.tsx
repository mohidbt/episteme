"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { HistoryIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DiffView } from "./DiffView";

type Revision = {
  id: string;
  createdAt: string;
  reason: string;
  charCount: number;
  authorKind: "user" | "agent";
  agentSkill: string | null;
};

type AuthorFilter = "all" | "user" | "agent";

const REASON_CLASS: Record<string, string> = {
  autosave: "bg-muted text-muted-foreground",
  manual: "bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  "pre-ai-edit":
    "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  "conflict-resolve":
    "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-300",
};

function ReasonBadge({ reason }: { reason: string }) {
  const cls = REASON_CLASS[reason] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {reason}
    </span>
  );
}

function AgentChip({ skill }: { skill: string | null }) {
  return (
    <span
      data-testid="agent-chip"
      className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
    >
      {skill ? `\u{1F916} agent · ${skill}` : "\u{1F916} agent"}
    </span>
  );
}

export function VersionDrawer({
  noteId,
  currentMd,
  onBeforeRestore,
  onAfterRestore,
  open,
  onOpenChange,
}: {
  noteId: string;
  currentMd: string;
  onBeforeRestore?: () => Promise<void> | void;
  onAfterRestore?: () => void;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setIsOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedBody, setSelectedBody] = useState<string | null>(null);
  const [isLoadingBody, setIsLoadingBody] = useState(false);
  const [isConfirmingRestore, setIsConfirmingRestore] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [authorFilter, setAuthorFilter] = useState<AuthorFilter>("all");

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`/api/notes/${noteId}/revisions`);
      if (!res.ok) {
        setRevisions([]);
        return;
      }
      const data = (await res.json()) as Revision[];
      setRevisions(data);
    } catch {
      setRevisions([]);
    }
  }, [noteId]);

  useEffect(() => {
    if (!isOpen) return;
    void loadList();
  }, [isOpen, loadList]);

  const handleSelect = useCallback(
    async (rev: Revision) => {
      setSelected(rev.id);
      setSelectedBody(null);
      setIsLoadingBody(true);
      try {
        const res = await fetch(
          `/api/notes/${noteId}/revisions/${rev.id}`,
        );
        if (res.ok) {
          const data = (await res.json()) as { contentMd: string };
          setSelectedBody(data.contentMd ?? "");
        } else {
          setSelectedBody("");
        }
      } catch {
        setSelectedBody("");
      } finally {
        setIsLoadingBody(false);
      }
    },
    [noteId],
  );

  const handleSaveVersion = useCallback(async () => {
    setIsSaving(true);
    try {
      await fetch(`/api/notes/${noteId}/revisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "manual" }),
      });
      await loadList();
    } finally {
      setIsSaving(false);
    }
  }, [noteId, loadList]);

  const handleConfirmRestore = useCallback(async () => {
    if (!selected) return;
    setIsRestoring(true);
    try {
      await onBeforeRestore?.();
      await fetch(`/api/notes/${noteId}/revisions/${selected}/restore`, {
        method: "POST",
      });
      setIsConfirmingRestore(false);
      setIsOpen(false);
      onAfterRestore?.();
    } finally {
      setIsRestoring(false);
    }
  }, [noteId, selected, onBeforeRestore, onAfterRestore]);

  return (
    <>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Versions">
              <HistoryIcon />
            </Button>
          }
        />
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>Versions</SheetTitle>
            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveVersion}
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save version"}
              </Button>
              <select
                aria-label="Filter revisions by author"
                value={authorFilter}
                onChange={(e) =>
                  setAuthorFilter(e.target.value as AuthorFilter)
                }
                className="rounded border bg-background px-2 py-1 text-xs"
              >
                <option value="all">All</option>
                <option value="user">User only</option>
                <option value="agent">Agent only</option>
              </select>
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-auto">
            {revisions === null ? (
              <div className="p-4 text-xs text-muted-foreground">Loading...</div>
            ) : revisions.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">
                No versions yet.
              </div>
            ) : (
              <ul className="divide-y">
                {revisions
                  .filter((rev) =>
                    authorFilter === "all"
                      ? true
                      : rev.authorKind === authorFilter,
                  )
                  .map((rev) => {
                    const isSel = rev.id === selected;
                    return (
                      <li
                        key={rev.id}
                        onClick={() => handleSelect(rev)}
                        className={`cursor-pointer px-4 py-3 text-xs transition-colors hover:bg-muted ${
                          isSel ? "bg-muted" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">
                            {formatDistanceToNow(new Date(rev.createdAt), {
                              addSuffix: true,
                            })}
                          </span>
                          <div className="flex items-center gap-1">
                            <ReasonBadge reason={rev.reason} />
                            {rev.authorKind === "agent" && (
                              <AgentChip skill={rev.agentSkill} />
                            )}
                          </div>
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {rev.charCount} chars
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
          {selected && (
            <div className="border-t p-3">
              {isLoadingBody || selectedBody === null ? (
                <div className="text-xs text-muted-foreground">
                  Loading diff...
                </div>
              ) : (
                <>
                  <DiffView prev={selectedBody} next={currentMd} />
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setIsConfirmingRestore(true)}
                    >
                      Restore
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={isConfirmingRestore} onOpenChange={setIsConfirmingRestore}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>Restore this version?</span>
              {(() => {
                const sel = revisions?.find((r) => r.id === selected);
                return sel && sel.authorKind === "agent" ? (
                  <AgentChip skill={sel.agentSkill} />
                ) : null;
              })()}
            </DialogTitle>
            <DialogDescription>
              Your current content will be saved as an autosave revision
              before being replaced.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsConfirmingRestore(false)}
              disabled={isRestoring}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleConfirmRestore}
              disabled={isRestoring}
            >
              {isRestoring ? "Restoring..." : "Confirm restore"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
