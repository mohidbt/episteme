"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  inferType,
  type FrontmatterRow,
  type FrontmatterValue,
} from "@episteme/markdown";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Obsidian-style property rows rendered above the note body.
 *
 * Storage is YAML inside the markdown body (handled by the parent — this
 * component is a controlled view over a `FrontmatterRow[]`). Adding/editing/
 * removing a row calls `onChange` with the next array; serialization back to
 * markdown frontmatter happens in the caller.
 */
export function NoteFrontmatter({
  rows,
  onChange,
}: {
  rows: FrontmatterRow[];
  onChange: (next: FrontmatterRow[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const usedKeys = useMemo(
    () => new Set(rows.map((r) => r.key.toLowerCase())),
    [rows],
  );

  const updateRow = (idx: number, value: FrontmatterValue) => {
    const next = rows.slice();
    next[idx] = { ...next[idx], value, type: inferType(value) };
    onChange(next);
  };

  const removeRow = (idx: number) => {
    const next = rows.slice();
    next.splice(idx, 1);
    onChange(next);
  };

  const commitNewRow = () => {
    const k = draftKey.trim();
    if (!k || usedKeys.has(k.toLowerCase())) {
      setAdding(false);
      setDraftKey("");
      setDraftValue("");
      return;
    }
    const value = coerceInput(draftValue);
    onChange([...rows, { key: k, value, type: inferType(value) }]);
    setAdding(false);
    setDraftKey("");
    setDraftValue("");
  };

  return (
    <div
      data-testid="note-frontmatter"
      className="mb-4 rounded-lg border bg-[var(--bg-muted)] p-3"
    >
      {rows.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No properties yet.</p>
      ) : null}

      {rows.map((row, idx) => (
        <FrontmatterRowEditor
          key={`${row.key}-${idx}`}
          row={row}
          onChange={(v) => updateRow(idx, v)}
          onRemove={() => removeRow(idx)}
        />
      ))}

      {adding ? (
        <div className="mt-2 flex items-center gap-2">
          <Input
            data-testid="frontmatter-new-key"
            placeholder="key"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            className="h-8 w-32 text-sm"
          />
          <Input
            data-testid="frontmatter-new-value"
            placeholder="value"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitNewRow();
              }
            }}
            className="h-8 flex-1 text-sm"
          />
          <Button
            type="button"
            size="sm"
            data-testid="frontmatter-new-confirm"
            onClick={commitNewRow}
          >
            Add
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="frontmatter-add"
          className="mt-2 h-7 text-xs"
          onClick={() => setAdding(true)}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add property
        </Button>
      )}
    </div>
  );
}

function FrontmatterRowEditor({
  row,
  onChange,
  onRemove,
}: {
  row: FrontmatterRow;
  onChange: (v: FrontmatterValue) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 py-1"
      data-testid={`frontmatter-row-${row.key}`}
    >
      <span className="w-32 shrink-0 truncate text-sm font-medium text-muted-foreground">
        {row.key}
      </span>
      <div className="flex-1">
        <FrontmatterValueInput row={row} onChange={onChange} />
      </div>
      <button
        type="button"
        aria-label={`Remove ${row.key}`}
        data-testid={`frontmatter-remove-${row.key}`}
        onClick={onRemove}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function FrontmatterValueInput({
  row,
  onChange,
}: {
  row: FrontmatterRow;
  onChange: (v: FrontmatterValue) => void;
}) {
  if (row.type === "tags") {
    const tags = Array.isArray(row.value) ? row.value : [];
    return (
      <Input
        type="text"
        value={tags.join(", ")}
        onChange={(e) => {
          const next = e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          onChange(next);
        }}
        className="h-8 text-sm"
        data-testid={`frontmatter-value-${row.key}`}
      />
    );
  }
  if (row.type === "number") {
    return (
      <Input
        type="number"
        value={String(row.value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange("");
            return;
          }
          const n = Number(raw);
          onChange(Number.isFinite(n) ? n : raw);
        }}
        className="h-8 text-sm"
        data-testid={`frontmatter-value-${row.key}`}
      />
    );
  }
  if (row.type === "date") {
    return (
      <Input
        type="date"
        value={String(row.value)}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-sm"
        data-testid={`frontmatter-value-${row.key}`}
      />
    );
  }
  return (
    <Input
      type="text"
      value={String(row.value)}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 text-sm"
      data-testid={`frontmatter-value-${row.key}`}
    />
  );
}

/** Apply the same inference as `parseFrontmatterRows` to a raw string input. */
function coerceInput(raw: string): FrontmatterValue {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === "") return [];
    return inner
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  // Comma-separated bare values become tag chips.
  if (/,/.test(trimmed)) {
    return trimmed
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return trimmed;
}
