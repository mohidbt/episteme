"use client";

import { useMemo, useState } from "react";
import type { FrontmatterRow } from "@episteme/markdown";

type Props = {
  rows: FrontmatterRow[];
  onChange: (rows: FrontmatterRow[]) => void;
};

function inferType(key: string, rawValue: string): FrontmatterRow["type"] {
  if (key.toLowerCase() === "tags" || rawValue.includes(",")) return "tags";
  if (/^\d+(\.\d+)?$/.test(rawValue.trim())) return "number";
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue.trim())) return "date";
  return "text";
}

function normalizeValue(type: FrontmatterRow["type"], rawValue: string): FrontmatterRow["value"] {
  if (type === "tags") {
    return rawValue
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (type === "number") return Number(rawValue);
  return rawValue;
}

export function NoteFrontmatter({ rows, onChange }: Props) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const safeRows = useMemo(() => rows ?? [], [rows]);

  const onEdit = (idx: number, value: string) => {
    const next = safeRows.map((row, i) =>
      i === idx ? { ...row, value: normalizeValue(row.type, value) } : row,
    );
    onChange(next);
  };

  const onRemove = (key: string) => {
    onChange(safeRows.filter((r) => r.key !== key));
  };

  const onAdd = () => {
    const key = newKey.trim();
    if (!key) return;
    const type = inferType(key, newValue);
    const value = normalizeValue(type, newValue);
    onChange([...safeRows, { key, value, type }]);
    setNewKey("");
    setNewValue("");
  };

  return (
    <div>
      {safeRows.map((row, idx) => {
        const value =
          row.type === "tags" && Array.isArray(row.value)
            ? row.value.join(", ")
            : String(row.value ?? "");
        const inputType = row.type === "number" ? "number" : row.type === "date" ? "date" : "text";
        return (
          <div key={row.key}>
            <input
              data-testid={`frontmatter-value-${row.key}`}
              type={inputType}
              value={value}
              onChange={(e) => onEdit(idx, e.target.value)}
            />
            <button
              type="button"
              data-testid={`frontmatter-remove-${row.key}`}
              onClick={() => onRemove(row.key)}
            >
              Remove
            </button>
          </div>
        );
      })}

      <button type="button" data-testid="frontmatter-add">
        Add
      </button>
      <input
        data-testid="frontmatter-new-key"
        value={newKey}
        onChange={(e) => setNewKey(e.target.value)}
      />
      <input
        data-testid="frontmatter-new-value"
        value={newValue}
        onChange={(e) => setNewValue(e.target.value)}
      />
      <button type="button" data-testid="frontmatter-new-confirm" onClick={onAdd}>
        Confirm
      </button>
    </div>
  );
}
