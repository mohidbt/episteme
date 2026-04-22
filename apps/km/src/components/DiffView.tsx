"use client";
import { diffWordsWithSpace } from "diff";
import { useMemo } from "react";

export function DiffView({ prev, next }: { prev: string; next: string }) {
  const parts = useMemo(() => diffWordsWithSpace(prev, next), [prev, next]);
  return (
    <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed font-mono rounded-md border border-border bg-muted/30 p-3 max-h-96 overflow-auto">
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <span
              key={i}
              data-diff="added"
              className="bg-green-100 text-green-900 dark:bg-green-950/40 dark:text-green-300"
            >
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span
              key={i}
              data-diff="removed"
              className="bg-red-100 text-red-900 line-through dark:bg-red-950/40 dark:text-red-300"
            >
              {part.value}
            </span>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </pre>
  );
}
