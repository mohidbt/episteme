"use client";

/**
 * Custom <table> renderer for Streamdown markdown in agent chat. Adds a
 * hover toolbar over GFM tables with two actions:
 *   - Copy: writes the table to the clipboard as TSV (paste-friendly into
 *     Sheets/Excel/Numbers).
 *   - Download: saves the table as a .csv file.
 *
 * The underlying <table> markup is preserved untouched so Streamdown's
 * default styling continues to apply. We only wrap it in a positioned
 * container and walk the React tree to extract row/cell text.
 */

import { CheckIcon, CopyIcon, DownloadIcon } from "lucide-react";
import {
  isValidElement,
  useCallback,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { toast } from "sonner";

interface ChatTableProps {
  children?: ReactNode;
  className?: string;
}

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    const children = (node.props as { children?: ReactNode }).children;
    return extractText(children);
  }
  return "";
}

function isElementOfType(node: ReactNode, type: string): node is ReactElement {
  return isValidElement(node) && (node.type === type);
}

function childrenAsArray(node: ReactNode): ReactNode[] {
  if (node == null) return [];
  return Array.isArray(node) ? node : [node];
}

/** Walk <table> → [<thead>?, <tbody>?] → <tr>s → <th|td>s. Return matrix of strings. */
function tableToMatrix(children: ReactNode): string[][] {
  const rows: string[][] = [];
  for (const section of childrenAsArray(children)) {
    if (!isValidElement(section)) continue;
    const sectionChildren = (section.props as { children?: ReactNode }).children;
    for (const tr of childrenAsArray(sectionChildren)) {
      if (!isElementOfType(tr, "tr")) continue;
      const cells: string[] = [];
      for (const cell of childrenAsArray((tr.props as { children?: ReactNode }).children)) {
        if (isElementOfType(cell, "th") || isElementOfType(cell, "td")) {
          cells.push(extractText((cell.props as { children?: ReactNode }).children).trim());
        }
      }
      if (cells.length > 0) rows.push(cells);
    }
  }
  return rows;
}

function toTsv(matrix: string[][]): string {
  return matrix
    .map((row) => row.map((c) => c.replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t"))
    .join("\n");
}

function csvEscape(field: string): string {
  if (/[",\n\r]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

function toCsv(matrix: string[][]): string {
  return matrix.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function ChatTable({ children, className }: ChatTableProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      toast.error("Clipboard API not available");
      return;
    }
    const matrix = tableToMatrix(children);
    if (matrix.length === 0) {
      toast.error("Empty table");
      return;
    }
    try {
      await navigator.clipboard.writeText(toTsv(matrix));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Failed to copy");
    }
  }, [children]);

  const onDownload = useCallback(() => {
    const matrix = tableToMatrix(children);
    if (matrix.length === 0) {
      toast.error("Empty table");
      return;
    }
    const csv = toCsv(matrix);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "table.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [children]);

  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <div className="group/chat-table relative my-2">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border bg-background/80 p-0.5 shadow-sm opacity-0 transition-opacity group-hover/chat-table:opacity-100">
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy table"
          title="Copy table (TSV)"
          data-testid="chat-table-copy"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDownload}
          aria-label="Download table as CSV"
          title="Download table as CSV"
          data-testid="chat-table-download"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <table className={className}>{children}</table>
    </div>
  );
}
