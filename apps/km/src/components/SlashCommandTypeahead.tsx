"use client";

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";

export interface SlashCommandTypeaheadRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export interface SlashCommandPick {
  title: string;
}

export interface SlashCommandTypeaheadProps {
  query: string;
  onSelect: (payload: SlashCommandPick) => void;
}

interface SlashCommandItem {
  title: string;
  description: string;
  keywords: string[];
  icon: string;
}

const COMMANDS: SlashCommandItem[] = [
  {
    title: "AI",
    description: "Ask AI to write or edit",
    keywords: ["ai", "ask", "write", "edit", "rephrase", "generate"],
    icon: "✨",
  },
];

export const SlashCommandTypeahead = forwardRef<
  SlashCommandTypeaheadRef,
  SlashCommandTypeaheadProps
>(function SlashCommandTypeahead({ query, onSelect }, ref) {
  const [selected, setSelected] = useState(0);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return COMMANDS;
    return COMMANDS.filter((cmd) => {
      const haystack = `${cmd.title} ${cmd.description} ${cmd.keywords.join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [query]);

  // Reset selection when filtered list changes
  useMemo(() => {
    setSelected(0);
  }, [filtered.length]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelected((i) =>
            filtered.length === 0 ? 0 : (i + filtered.length - 1) % filtered.length,
          );
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
          return true;
        }
        if (event.key === "Enter") {
          if (filtered.length > 0) {
            onSelect({ title: filtered[selected].title });
          }
          return true;
        }
        if (event.key === "Escape") {
          return true; // Let the suggestion plugin handle dismissal
        }
        return false;
      },
    }),
    [filtered, selected, onSelect],
  );

  if (filtered.length === 0) {
    return (
      <div className="z-50 min-w-[260px] rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
        No commands found
      </div>
    );
  }

  return (
    <div className="z-50 min-w-[280px] rounded-md border bg-popover p-1 text-sm shadow-md">
      {filtered.map((cmd, i) => (
        <button
          key={cmd.title}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect({ title: cmd.title });
          }}
          className={`w-full rounded px-2 py-1.5 text-left flex items-center gap-2 ${
            i === selected ? "bg-accent text-accent-foreground" : ""
          }`}
        >
          <span className="text-base">{cmd.icon}</span>
          <div>
            <div className="font-medium">{cmd.title}</div>
            <div className="text-xs text-muted-foreground">{cmd.description}</div>
          </div>
        </button>
      ))}
    </div>
  );
});