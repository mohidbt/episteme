"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { invalidateDriveTree } from "@/lib/drive-sync";

interface ColumnDraft {
  name: string;
  description: string;
}

interface PapersetCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string | null;
}

export function PapersetCreateDialog({
  open,
  onOpenChange,
  folderId,
}: PapersetCreateDialogProps) {
  const router = useRouter();
  const filenameId = useId();
  const [filename, setFilename] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([
    { name: "", description: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedFilename = filename.trim();
  const allColumnsValid = columns.every(
    (c) => c.name.trim() && c.description.trim(),
  );
  const canSubmit =
    !!trimmedFilename && columns.length >= 1 && allColumnsValid && !submitting;

  function reset() {
    setFilename("");
    setColumns([{ name: "", description: "" }]);
    setError(null);
    setSubmitting(false);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/papersets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: trimmedFilename,
          folderId,
          columns: columns.map((c) => ({
            name: c.name.trim(),
            description: c.description.trim(),
          })),
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Failed to create paperset.");
        return;
      }
      const row = (await res.json()) as { id: string };
      onOpenChange(false);
      reset();
      router.push(`/d/${row.id}`);
      router.refresh();
      invalidateDriveTree();
    } catch {
      setError("Failed to create paperset.");
    } finally {
      setSubmitting(false);
    }
  }

  function updateColumn(index: number, next: ColumnDraft) {
    setColumns((cs) => cs.map((c, i) => (i === index ? next : c)));
  }

  function addColumn() {
    setColumns((cs) => [...cs, { name: "", description: "" }]);
  }

  function removeColumn(index: number) {
    setColumns((cs) => cs.filter((_, i) => i !== index));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New paperset</DialogTitle>
          <DialogDescription>
            Define a CSV with columns for AI-enriched fields.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor={filenameId}>Filename</FieldLabel>
            <Input
              id={filenameId}
              value={filename}
              onChange={(e) => setFilename(e.currentTarget.value)}
              placeholder="bench-eval"
              autoFocus
            />
            <FieldDescription>
              Saved as <code className="font-mono">.csv</code> in the current
              folder.
            </FieldDescription>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <FieldLabel className="text-sm font-medium">Columns</FieldLabel>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addColumn}
              >
                <Plus className="size-4" aria-hidden /> Add column
              </Button>
            </div>
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
              {columns.map((col, i) => (
                <ColumnRow
                  key={i}
                  index={i}
                  column={col}
                  onChange={(next) => updateColumn(i, next)}
                  onRemove={
                    columns.length > 1 ? () => removeColumn(i) : undefined
                  }
                />
              ))}
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ColumnRowProps {
  index: number;
  column: ColumnDraft;
  onChange: (next: ColumnDraft) => void;
  onRemove?: () => void;
}

function ColumnRow({ index, column, onChange, onRemove }: ColumnRowProps) {
  const nameId = useId();
  const descId = useId();
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={nameId}>Column name</FieldLabel>
          <Input
            id={nameId}
            value={column.name}
            onChange={(e) => onChange({ ...column, name: e.currentTarget.value })}
            placeholder="assay_type"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={descId}>Description</FieldLabel>
          <Textarea
            id={descId}
            value={column.description}
            onChange={(e) =>
              onChange({ ...column, description: e.currentTarget.value })
            }
            placeholder="What kind of biological assay was used? e.g. ChIP-seq, RNA-seq."
            rows={2}
          />
        </div>
      </div>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={`Remove column ${index + 1}`}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
