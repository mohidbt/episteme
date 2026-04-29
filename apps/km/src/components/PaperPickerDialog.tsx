"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Paper {
  id: string;
  title: string | null;
  filename: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (paperIds: string[]) => void;
  excludeIds: string[];
  libraryId?: number | null;
}

export function PaperPickerDialog({
  open,
  onOpenChange,
  onConfirm,
  excludeIds,
  libraryId,
}: Props) {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setQuery("");
    const url = libraryId != null ? `/api/papers?libraryId=${libraryId}` : "/api/papers";
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setPapers(Array.isArray(data) ? data : []))
      .catch((e) => setError(String((e as Error).message ?? e)))
      .finally(() => setLoading(false));
  }, [open, libraryId]);

  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return papers
      .filter((p) => !exclude.has(p.id))
      .filter((p) => {
        if (!q) return true;
        const t = (p.title ?? "").toLowerCase();
        const f = p.filename.toLowerCase();
        return t.includes(q) || f.includes(q);
      });
  }, [papers, exclude, query]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add papers</DialogTitle>
        </DialogHeader>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title or filename"
          aria-label="Search papers"
        />
        <ul
          className="max-h-80 overflow-y-auto rounded-md border"
          role="listbox"
          aria-multiselectable
        >
          {loading && (
            <li className="p-3 text-sm text-muted-foreground">Loading…</li>
          )}
          {error && (
            <li role="alert" className="p-3 text-sm text-destructive">
              {error}
            </li>
          )}
          {!loading && !error && visible.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">
              {papers.length === 0 ? "No papers yet." : "No papers match."}
            </li>
          )}
          {!loading &&
            !error &&
            visible.map((p) => {
              const isSel = selected.has(p.id);
              return (
                <li key={p.id} role="option" aria-selected={isSel}>
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 ${
                      isSel ? "bg-muted" : ""
                    }`}
                  >
                    <span>{p.title ?? p.filename}</span>
                    {isSel && <Check className="size-4" aria-hidden />}
                  </button>
                </li>
              );
            })}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={selected.size === 0}
            onClick={() => onConfirm([...selected])}
          >
            Add{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
