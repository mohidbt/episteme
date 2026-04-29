"use client";

import { useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { ColumnSpec } from "./lib/grid-helpers";

interface Props {
  papersetId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onColumnAdded: (column: ColumnSpec) => void;
}

export function AddColumnDialog({
  papersetId,
  open,
  onOpenChange,
  onColumnAdded,
}: Props) {
  const nameId = useId();
  const descId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim() && description.trim() && !submitting;

  function reset() {
    setName("");
    setDescription("");
    setError(null);
    setSubmitting(false);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/papersets/${papersetId}/columns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Failed to add column.");
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as {
        columns?: ColumnSpec[];
      };
      const columns = Array.isArray(payload.columns) ? payload.columns : [];
      const added =
        columns.find((c) => c.name === name.trim()) ?? {
          name: name.trim(),
          description: description.trim(),
        };
      onColumnAdded(added);
      onOpenChange(false);
      reset();
    } catch {
      setError("Failed to add column.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add column</DialogTitle>
          <DialogDescription>
            New column appended to the right of the grid.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={nameId}>Name</FieldLabel>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="assay_type"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={descId}>Description</FieldLabel>
            <Textarea
              id={descId}
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              rows={3}
              placeholder="What kind of biological assay was used?"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
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
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
