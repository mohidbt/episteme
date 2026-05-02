"use client";

// Phase 1.4.x — Task 11: agent-config export/import settings UI.
//
// Two halves:
//  - Export: button → GET /api/agent/export → blob → trigger download.
//  - Import: file picker → POST /api/agent/import (no confirm) → diff dialog
//    → Apply → POST again with confirm=true.
import * as React from "react";
import { toast } from "sonner";
import {
  Button,
} from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BundleDiff } from "@/lib/agent-config-bundle";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function NoteList({
  label,
  paths,
  tone,
}: {
  label: string;
  paths: string[];
  tone: "added" | "removed" | "modified";
}) {
  if (paths.length === 0) return null;
  const toneClass =
    tone === "added"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "removed"
        ? "text-red-600 dark:text-red-400"
        : "text-amber-600 dark:text-amber-400";
  return (
    <div className="flex flex-col gap-1">
      <div className={`text-xs font-medium ${toneClass}`}>
        {label} ({paths.length})
      </div>
      <ul className="list-disc pl-5 text-xs text-muted-foreground">
        {paths.map((p) => (
          <li key={p} className="truncate">
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BundleDiffView({ diff }: { diff: BundleDiff }) {
  const sections: Array<{
    title: string;
    body: React.ReactNode;
  }> = [
    {
      title: "Skills",
      body:
        diff.skills.added.length === 0 &&
        diff.skills.removed.length === 0 &&
        diff.skills.modified.length === 0 ? (
          <p className="text-xs text-muted-foreground">No changes</p>
        ) : (
          <div className="flex flex-col gap-2">
            <NoteList label="Added" paths={diff.skills.added} tone="added" />
            <NoteList label="Removed" paths={diff.skills.removed} tone="removed" />
            <NoteList label="Modified" paths={diff.skills.modified} tone="modified" />
          </div>
        ),
    },
    {
      title: "Personal Skills",
      body:
        diff.personalSkills.added.length === 0 &&
        diff.personalSkills.removed.length === 0 &&
        diff.personalSkills.modified.length === 0 ? (
          <p className="text-xs text-muted-foreground">No changes</p>
        ) : (
          <div className="flex flex-col gap-2">
            <NoteList label="Added" paths={diff.personalSkills.added} tone="added" />
            <NoteList label="Removed" paths={diff.personalSkills.removed} tone="removed" />
            <NoteList label="Modified" paths={diff.personalSkills.modified} tone="modified" />
          </div>
        ),
    },
    {
      title: "Memories",
      body:
        diff.memories.added.length === 0 &&
        diff.memories.removed.length === 0 &&
        diff.memories.modified.length === 0 ? (
          <p className="text-xs text-muted-foreground">No changes</p>
        ) : (
          <div className="flex flex-col gap-2">
            <NoteList label="Added" paths={diff.memories.added} tone="added" />
            <NoteList label="Removed" paths={diff.memories.removed} tone="removed" />
            <NoteList label="Modified" paths={diff.memories.modified} tone="modified" />
          </div>
        ),
    },
    {
      title: "Settings",
      body:
        diff.settings.changed.length === 0 ? (
          <p className="text-xs text-muted-foreground">No changes</p>
        ) : (
          <ul className="list-disc pl-5 text-xs text-amber-600 dark:text-amber-400">
            {diff.settings.changed.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      {sections.map((s) => (
        <section key={s.title} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{s.title}</h3>
          {s.body}
        </section>
      ))}
    </div>
  );
}

export function ConfigExportImport() {
  const [exporting, setExporting] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [diff, setDiff] = React.useState<BundleDiff | null>(null);
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const exportBtnRef = React.useRef<HTMLButtonElement>(null);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/agent/export");
      if (!res.ok) throw new Error(`http ${res.status}`);
      const blob = await res.blob();
      triggerDownload(blob, "agent-config.zip");
      toast.success("Config exported");
    } catch (err) {
      toast.error(
        `Export failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setPendingFile(file);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/agent/import", { method: "POST", body: fd });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ error: `http ${res.status}` }));
        throw new Error((detail as { error?: string }).error ?? `http ${res.status}`);
      }
      const body = (await res.json()) as { diff: BundleDiff };
      setDiff(body.diff);
    } catch (err) {
      toast.error(
        `Import failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
      setPendingFile(null);
    } finally {
      setImporting(false);
      // reset input so picking the same file again still triggers change
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleApply() {
    if (!pendingFile) return;
    setApplying(true);
    try {
      const fd = new FormData();
      fd.append("file", pendingFile);
      fd.append("confirm", "true");
      const res = await fetch("/api/agent/import", { method: "POST", body: fd });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ error: `http ${res.status}` }));
        throw new Error((detail as { error?: string }).error ?? `http ${res.status}`);
      }
      toast.success("Config imported");
      setDiff(null);
      setPendingFile(null);
    } catch (err) {
      toast.error(
        `Apply failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    } finally {
      setApplying(false);
    }
  }

  function handleCancel() {
    setDiff(null);
    setPendingFile(null);
  }

  return (
    <div data-testid="agent-config-export-import" className="flex flex-col gap-6 mt-4">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Export</h3>
          <p className="text-xs text-muted-foreground">
            Download a .zip containing your skills, memories, and settings.
            OAuth credentials are stripped.
          </p>
          <div>
            <Button
              ref={exportBtnRef}
              type="button"
              onClick={handleExport}
              disabled={exporting}
              data-testid="agent-config-export-button"
            >
              {exporting ? "Exporting…" : "Export config"}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Import</h3>
          <p className="text-xs text-muted-foreground">
            Pick a previously-exported .zip. You will see a diff before
            anything is applied.
          </p>
          <div>
            <input
              ref={fileRef}
              id="agent-config-import-file"
              type="file"
              accept=".zip,application/zip"
              onChange={handleFile}
              disabled={importing}
              data-testid="agent-config-import-input"
              className="sr-only"
            />
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              data-testid="agent-config-import-button"
            >
              {importing ? "Importing…" : "Add Zip File"}
            </Button>
          </div>
        </div>

      <Dialog
        open={diff !== null}
        onOpenChange={(o) => {
          if (!o) {
            handleCancel();
            // a11y: return focus to Export button after dialog close
            requestAnimationFrame(() => exportBtnRef.current?.focus());
          }
        }}
      >
        <DialogContent data-testid="agent-config-diff-dialog">
          <DialogHeader>
            <DialogTitle>Review config import</DialogTitle>
            <DialogDescription>
              Apply this bundle? Changes are additive — nothing is deleted.
            </DialogDescription>
          </DialogHeader>
          {diff ? <BundleDiffView diff={diff} /> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={applying}
              data-testid="agent-config-cancel-button"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleApply}
              disabled={applying}
              data-testid="agent-config-apply-button"
            >
              {applying ? "Applying…" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
