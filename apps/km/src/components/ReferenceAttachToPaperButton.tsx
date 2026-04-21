"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface PaperOption {
  id: string;
  title: string | null;
  filename: string;
  year: number | null;
}

interface Props {
  referenceId: string;
  currentPaperId: string | null;
  papers: PaperOption[];
}

export function ReferenceAttachToPaperButton({
  referenceId,
  currentPaperId,
  papers,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return papers;
    return papers.filter((p) => {
      const title = (p.title ?? "").toLowerCase();
      const filename = p.filename.toLowerCase();
      return title.includes(q) || filename.includes(q);
    });
  }, [papers, query]);

  async function setPaperId(paperId: string | null) {
    setPending(true);
    try {
      const res = await fetch(`/api/references/${referenceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paperId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ?? "Failed to update");
        return;
      }
      toast.success(paperId === null ? "Detached" : "Attached");
      setOpen(false);
      setQuery("");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setPending(false);
    }
  }

  const triggerLabel = currentPaperId ? "Change paper" : "Attach to paper…";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" type="button">
            <Link2 className="h-4 w-4" aria-hidden />
            {triggerLabel}
          </Button>
        }
      />
      <DialogContent className="w-[min(480px,calc(100vw-2rem))] overflow-hidden grid-cols-1 sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Attach to a paper</DialogTitle>
        </DialogHeader>

        {papers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No papers in this library yet. Upload a PDF first.
          </p>
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            <Input
              placeholder="Search by title or filename…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />

            {currentPaperId && (
              <button
                type="button"
                disabled={pending}
                onClick={() => setPaperId(null)}
                className="flex items-center gap-2 self-start rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-60"
              >
                <Link2Off className="h-3.5 w-3.5" aria-hidden />
                Detach from current paper
              </button>
            )}

            <ul className="max-h-[50vh] overflow-y-auto rounded-md border border-border/60 divide-y divide-border/60">
              {filtered.length === 0 ? (
                <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No papers match &quot;{query}&quot;.
                </li>
              ) : (
                filtered.map((p) => {
                  const display = p.title && p.title.trim().length > 0 ? p.title : p.filename;
                  const isCurrent = p.id === currentPaperId;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={pending || isCurrent}
                        onClick={() => setPaperId(p.id)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60 disabled:opacity-60"
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-sm leading-tight">{display}</span>
                          {p.title && (
                            <span className="block truncate text-xs leading-tight text-muted-foreground">
                              {p.filename}
                            </span>
                          )}
                        </span>
                        {p.year != null && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {p.year}
                          </span>
                        )}
                        {isCurrent && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">current</span>
                        )}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
