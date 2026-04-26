"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { CitationTypeahead, type CitationTypeaheadRef, type CitationPick } from "./CitationTypeahead";
import { PdfTypeahead, type PdfTypeaheadRef, type PdfPick } from "./PdfTypeahead";
import { WikiLinkTypeahead, type WikiLinkTypeaheadRef, type WikiLinkPick } from "./WikiLinkTypeahead";
import { AgentTypeahead, type AgentTypeaheadRef, type AgentPick } from "./AgentTypeahead";

export interface SlashCommandTypeaheadRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export interface SlashCommandPick {
  title: string;
  citation?: CitationPick;
  pdfEmbed?: PdfPick;
  wikiLink?: WikiLinkPick;
  agent?: AgentPick;
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
  {
    title: "PDF",
    description: "Embed a PDF from your library",
    keywords: ["pdf", "embed", "paper", "reader", "document"],
    icon: "📄",
  },
  {
    title: "Link",
    description: "Link to a note, reference, or paper",
    keywords: ["link", "wiki", "note", "reference", "[["],
    icon: "🔗",
  },
  {
    title: "Agent",
    description: "Run an AI agent on this note",
    keywords: ["agent", "ai", "run", "skill", "triage", "synthesize"],
    icon: "🤖",
  },
  {
    title: "Table",
    description: "Insert a 3×3 table",
    keywords: ["table", "grid", "rows", "columns"],
    icon: "▦",
  },
  {
    title: "Code Block",
    description: "Insert a code block with syntax highlighting",
    keywords: ["code", "block", "snippet", "syntax", "fence", "```"],
    icon: "{ }",
  },
];

export const SlashCommandTypeahead = forwardRef<
  SlashCommandTypeaheadRef,
  SlashCommandTypeaheadProps
>(function SlashCommandTypeahead({ query, onSelect }, ref) {
  const [selected, setSelected] = useState(0);
  // Mode: "commands" | "cite" | "pdf" | "link" | "agent"
  const [mode, setMode] = useState<"commands" | "cite" | "pdf" | "link" | "agent">("commands");
  // Query within sub-command mode — typed after selecting the sub-command
  const [citeQuery, setCiteQuery] = useState("");
  const citationRef = useRef<CitationTypeaheadRef | null>(null);
  const pdfRef = useRef<PdfTypeaheadRef | null>(null);
  const wikiLinkRef = useRef<WikiLinkTypeaheadRef | null>(null);
  const agentRef = useRef<AgentTypeaheadRef | null>(null);

  const filtered = useMemo(() => {
    if (mode === "cite" || mode === "pdf" || mode === "link" || mode === "agent") return [];
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

        if (mode === "pdf") {
          // Backspace when citeQuery empty → go back to command list
          if (event.key === "Backspace" && citeQuery === "") {
            setMode("commands");
            setCiteQuery("");
            return true;
          }
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            setCiteQuery((q) => q + event.key);
            return true;
          }
          if (event.key === "Backspace") {
            setCiteQuery((q) => q.slice(0, -1));
            return true;
          }
          return pdfRef.current?.onKeyDown({ event }) ?? false;
        }

        if (mode === "link") {
          if (event.key === "Backspace" && citeQuery === "") {
            setMode("commands");
            setCiteQuery("");
            return true;
          }
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            setCiteQuery((q) => q + event.key);
            return true;
          }
          if (event.key === "Backspace") {
            setCiteQuery((q) => q.slice(0, -1));
            return true;
          }
          return wikiLinkRef.current?.onKeyDown({ event }) ?? false;
        }

        if (mode === "agent") {
          if (event.key === "Backspace" && citeQuery === "") {
            setMode("commands");
            setCiteQuery("");
            return true;
          }
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            setCiteQuery((q) => q + event.key);
            return true;
          }
          if (event.key === "Backspace") {
            setCiteQuery((q) => q.slice(0, -1));
            return true;
          }
          return agentRef.current?.onKeyDown({ event }) ?? false;
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
            if (cmd.title === "PDF") {
              setMode("pdf");
              setCiteQuery("");
              return true;
            }
            if (cmd.title === "Link") {
              setMode("link");
              setCiteQuery("");
              return true;
            }
            if (cmd.title === "Agent") {
              setMode("agent");
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

  if (mode === "pdf") {
    return (
      <PdfTypeahead
        ref={pdfRef}
        query={citeQuery}
        onSelect={(pdfEmbed: PdfPick) => {
          onSelect({ title: "PDF", pdfEmbed });
        }}
      />
    );
  }

  if (mode === "link") {
    return (
      <WikiLinkTypeahead
        ref={wikiLinkRef}
        query={citeQuery}
        onSelect={(wikiLink: WikiLinkPick) => {
          onSelect({ title: "Link", wikiLink });
        }}
      />
    );
  }

  if (mode === "agent") {
    return (
      <AgentTypeahead
        ref={agentRef}
        query={citeQuery}
        onSelect={(agent: AgentPick) => {
          onSelect({ title: "Agent", agent });
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
            if (cmd.title === "PDF") {
              setMode("pdf");
              setCiteQuery("");
              return;
            }
            if (cmd.title === "Link") {
              setMode("link");
              setCiteQuery("");
              return;
            }
            if (cmd.title === "Agent") {
              setMode("agent");
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
