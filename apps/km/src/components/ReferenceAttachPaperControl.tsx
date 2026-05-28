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

// O2: restored manual paper attach + disconnect for /r/[id]. Replaces
// ReferenceAttachToPaperButton deleted in b8b7556. Talks to the dedicated
// /attach-paper endpoint so the manual identity contract is explicit and
// distinct from the bibliography-citation auto-connect path.

interface PaperOption {
  id: string;
  title: string | null;
  filename: string;
  year: number | null;
}

interface Props {
  referenceId: string;
  attachedPaperId: string | null;
  papers: PaperOption[];
}

export function ReferenceAttachPaperControl({
  referenceId,
  attachedPaperId,
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

  async function attach(paperId: string) {
    setPending(true);
    try {
      const res = await fetch(`/api/references/${referenceId}/attach-paper`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paperId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ?? "Failed to attach paper");
        return;
      }
      toast.success("Attached");
      setOpen(false);
      setQuery("");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setPending(false);
    }
  }

  async function detach() {
    setPending(true);
    try {
      const res = await fetch(`/api/references/${referenceId}/attach-paper`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ?? "Failed to disconnect");
        return;
      }
      toast.success("Disconnected");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setPending(false);
    }
  }

  if (attachedPaperId) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={detach}
        aria-label="Disconnect paper from this reference"
      >
        <Link2Off className="h-4 w-4" aria-hidden />
        Disconnect
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" type="button">
            <Link2 className="h-4 w-4" aria-hidden />
            Attach a paper
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

            <ul className="max-h-[50vh] divide-y divide-border/60 overflow-y-auto rounded-md border border-border/60">
              {filtered.length === 0 ? (
                <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No papers match &quot;{query}&quot;.
                </li>
              ) : (
                filtered.map((p) => {
                  const display =
                    p.title && p.title.trim().length > 0 ? p.title : p.filename;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => attach(p.id)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60 disabled:opacity-60"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm leading-tight">
                            {display}
                          </span>
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
