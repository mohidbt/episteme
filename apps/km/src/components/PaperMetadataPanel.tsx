"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { papers } from "@episteme/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InPapersetsBadge } from "@/components/InPapersetsBadge";

type PaperRow = typeof papers.$inferSelect;

interface PapersetItem {
  id: string;
  filename: string;
}

interface PaperMetadataPanelProps {
  paper: PaperRow;
  onSaved?: (updated: PaperRow) => void;
  /** Number of papersets containing this paper. When 0 the badge is hidden. */
  papersetCount?: number;
  /** Paperset list shown in the badge popover. */
  papersets?: PapersetItem[];
  /** Folder paths available in this library, plus optional "" root. */
  folderOptions?: string[];
}

const ROOT_VALUE = "__root__";

interface FormState {
  title: string;
  authors: string;
  year: string;
  doi: string;
  folderPath: string;
}

function toForm(p: PaperRow): FormState {
  return {
    title: p.title ?? "",
    authors: (p.authors ?? []).join(", "),
    year: p.year != null ? String(p.year) : "",
    doi: p.doi ?? "",
    folderPath: p.folderPath,
  };
}

function parseAuthors(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Build a minimal PATCH body containing only changed fields. Matches
// paperUpdateSchema (strict): title/authors/year/doi/folderPath.
// Empty-string semantics vary per schema: title keeps-on-empty (NOT NULL + min 1),
// year keeps-on-empty (schema disallows null), doi/authors/folderPath clear-on-empty.
function diffPatch(
  form: FormState,
  paper: PaperRow,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  const newTitle = form.title.trim();
  if (newTitle && newTitle !== (paper.title ?? "")) patch.title = newTitle;

  const newAuthors = parseAuthors(form.authors);
  if (!arraysEqual(newAuthors, paper.authors ?? [])) patch.authors = newAuthors;

  const yearTrim = form.year.trim();
  if (yearTrim === "") {
    // schema doesn't accept null for year; only send if user typed a value
  } else {
    const n = Number(yearTrim);
    if (Number.isFinite(n) && n !== paper.year) patch.year = n;
  }

  const doiTrim = form.doi.trim();
  if (doiTrim === "" && paper.doi != null) patch.doi = null;
  else if (doiTrim !== "" && doiTrim !== (paper.doi ?? "")) patch.doi = doiTrim;

  if (form.folderPath !== paper.folderPath) patch.folderPath = form.folderPath;

  return patch;
}

export function PaperMetadataPanel({
  paper,
  onSaved,
  papersetCount = 0,
  papersets = [],
  folderOptions = [],
}: PaperMetadataPanelProps) {
  const [form, setForm] = useState<FormState>(() => toForm(paper));
  const [busy, setBusy] = useState(false);

  const folderChoices = Array.from(new Set(["", ...folderOptions, paper.folderPath]));
  const doiUrl = form.doi.trim() ? `https://doi.org/${form.doi.trim()}` : "";

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const patch = diffPatch(form, paper);
    if (Object.keys(patch).length === 0) {
      toast.info("No changes");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/papers/${paper.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (res.status === 400 && body?.error === "validation") {
          const issues = Array.isArray(body.issues) ? body.issues : [];
          const first = issues[0];
          const desc = first
            ? `${(first.path ?? []).join(".") || "field"}: ${first.message}`
            : "Invalid input";
          toast.error("Validation failed", { description: desc });
        } else {
          toast.error("Save failed", { description: body?.error ?? `HTTP ${res.status}` });
        }
        return;
      }
      const updated = (await res.json()) as PaperRow;
      setForm(toForm(updated));
      toast.success("Saved");
      onSaved?.(updated);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div data-testid="metadata-header" className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Metadata
        </p>
        <InPapersetsBadge count={papersetCount} papersets={papersets} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="paper-title">Title</Label>
        <Input
          id="paper-title"
          value={form.title}
          onChange={(e) => set("title", e.currentTarget.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="paper-authors">Authors</Label>
        <Input
          id="paper-authors"
          value={form.authors}
          onChange={(e) => set("authors", e.currentTarget.value)}
          placeholder="Smith, Doe, Patel"
        />
        <p className="text-xs text-muted-foreground">Comma-separated.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="paper-year">Year</Label>
          <Input
            id="paper-year"
            type="number"
            inputMode="numeric"
            value={form.year}
            onChange={(e) => set("year", e.currentTarget.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="paper-doi">DOI</Label>
          <Input
            id="paper-doi"
            value={form.doi}
            onChange={(e) => set("doi", e.currentTarget.value)}
            placeholder="10.1000/xyz123"
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="paper-url">URL</Label>
        {doiUrl ? (
          <a
            id="paper-url"
            href={doiUrl}
            target="_blank"
            rel="noreferrer"
            className="block truncate rounded-md border border-input bg-muted/30 px-2.5 py-1.5 text-sm text-foreground hover:underline"
          >
            {doiUrl}
          </a>
        ) : (
          <p className="rounded-md border border-input bg-muted/30 px-2.5 py-1.5 text-sm text-muted-foreground">
            Add a DOI to generate a URL.
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="paper-folder">Folder</Label>
        <Select
          value={form.folderPath === "" ? ROOT_VALUE : form.folderPath}
          onValueChange={(v) => set("folderPath", !v || v === ROOT_VALUE ? "" : v)}
        >
          <SelectTrigger id="paper-folder" className="w-full">
            <SelectValue placeholder="Library root" />
          </SelectTrigger>
          <SelectContent>
            {folderChoices.map((path) => (
              <SelectItem key={path || ROOT_VALUE} value={path === "" ? ROOT_VALUE : path}>
                {path === "" ? "Library root" : path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
