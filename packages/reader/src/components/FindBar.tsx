"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  matchCase: boolean;
  onSearch: (q: string, opts: { matchCase: boolean }) => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleCase: () => void;
  onClose: () => void;
}

export function FindBar({ open, matchCase, onSearch, onNext, onPrev, onToggleCase, onClose }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="flex items-center gap-2 border-b bg-background px-3 py-1">
      <input
        ref={ref}
        type="text"
        className="h-7 rounded border px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        placeholder="Find in document…"
        onChange={(e) => onSearch(e.target.value, { matchCase })}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter") (e.shiftKey ? onPrev : onNext)();
        }}
      />
      <Button size="sm" variant="ghost" onClick={onPrev}>
        Prev
      </Button>
      <Button size="sm" variant="ghost" onClick={onNext}>
        Next
      </Button>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={matchCase} onChange={onToggleCase} /> Match case
      </label>
      <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close find">
        ×
      </Button>
    </div>
  );
}
