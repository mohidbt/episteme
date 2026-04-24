"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { CitationTypeahead, type CitationTypeaheadRef, type CitationPick } from "./CitationTypeahead";

export interface SlashCommandTypeaheadRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export interface SlashCommandPick {
  title: string;
  citation?: CitationPick;
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
  {
    title: "Cite",
    description: "Insert a citation from your library",
    keywords: ["cite", "citation", "reference", "paper", "bib"],
    icon: "📚",
  },
];

export const SlashCommandTypeahead = forwardRef<
  SlashCommandTypeaheadRef,
  SlashCommandTypeaheadProps
>(function SlashCommandTypeahead({ query, onSelect }, ref) {
  const [selected, setSelected] = useState(0);
  // Mode: "commands" (default slash menu) or "cite" (citation search sub-menu)
  const [mode, setMode] = useState<"commands" | "cite">("commands");
  // Query within citation mode — typed after selecting Cite
  const [citeQuery, setCiteQuery] = useState("");
  const citationRef = useRef<CitationTypeaheadRef | null>(null);

  const filtered = useMemo(() => {
    if (mode === "cite") return [];
    const q = query.toLowerCase().trim();
    if (!q) return COMMANDS;
    return COMMANDS.filter((cmd) => {
      const haystack = `${cmd.title} ${cmd.description} ${cmd.keywords.join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [query, mode]);

  // Reset selection when filtered list changes
  useEffect(() => {
    if (mode === "commands") setSelected(0);
  }, [filtered.length, mode]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (mode === "cite") {
          // Backspace when citeQuery empty → go back to command list
          if (event.key === "Backspace" && citeQuery === "") {
            setMode("commands");
            setCiteQuery("");
            return true;
          }
          // Alpha/digit keys extend the citeQuery
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            setCiteQuery((q) => q + event.key);
            return true;
          }
          if (event.key === "Backspace") {
            setCiteQuery((q) => q.slice(0, -1));
            return true;
          }
          // Delegate navigation/enter to CitationTypeahead
          return citationRef.current?.onKeyDown({ event }) ?? false;
        }

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
            const cmd = filtered[selected];
            if (cmd.title === "Cite") {
              setMode("cite");
              setCiteQuery("");
              return true;
            }
            onSelect({ title: cmd.title });
          }
          return true;
        }
        if (event.key === "Escape") {
          return true; // Let the suggestion plugin handle dismissal
        }
        return false;
      },
    }),
    [filtered, selected, onSelect, mode, citeQuery],
  );

  if (mode === "cite") {
    return (
      <CitationTypeahead
        ref={citationRef}
        query={citeQuery}
        onSelect={(citation: CitationPick) => {
          onSelect({ title: "Cite", citation });
        }}
      />
    );
  }

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
            if (cmd.title === "Cite") {
              setMode("cite");
              setCiteQuery("");
              return;
            }
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
