"use client";

import { BubbleMenu, type TiptapEditor } from "@episteme/editor";
import { useRef, useState, useCallback, useEffect } from "react";
import { runSlashAi } from "@/app/(app)/n/[slug]/run-slash-ai";
import type { SkillCategory } from "@/lib/skills";
import {
  Bold, Italic, Code, Loader2,
  ArrowDown, RefreshCw,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

type Mode = "format" | "rephrase-prompt" | "rephrase-streaming" | "rephrase-done";
type Source = "bubble" | "portal";

type SkillEntry = {
  name: string;
  title: string;
  description: string;
  instruction: string;
  category?: SkillCategory;
};

// Built-in rephrase style presets. Clicking one submits the rephrase directly
// with the preset instruction as the prompt — no extra typing.
const REPHRASE_PRESETS: ReadonlyArray<{ label: string; instruction: string }> = [
  { label: "Formal", instruction: "Rewrite in a formal, professional register." },
  { label: "Casual", instruction: "Rewrite in a casual, conversational tone." },
  { label: "Shorter", instruction: "Rewrite shorter and tighter while keeping the meaning." },
  { label: "Expand", instruction: "Expand with more detail and supporting context." },
  { label: "Academic", instruction: "Rewrite in an academic register suitable for a research paper." },
  { label: "Simplify", instruction: "Simplify so a non-expert reader can follow it." },
];

interface Turn {
  prompt: string;
  response: string;
}

function RephrasePanel({
  mode,
  prompt,
  setPrompt,
  aiOutput,
  turns,
  submitPrompt,
  submitWithPrompt,
  handleReplace,
  handleAppend,
  handleRefine,
  resetToFormat,
  source,
  maxWidth,
}: {
  mode: Mode;
  prompt: string;
  setPrompt: (v: string) => void;
  aiOutput: string;
  turns: Turn[];
  submitPrompt: () => void;
  submitWithPrompt: (prompt: string) => void;
  handleReplace?: () => void;
  handleAppend: () => void;
  handleRefine: () => void;
  resetToFormat: () => void;
  source: Source;
  maxWidth?: string;
}) {
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skills, setSkills] = useState<SkillEntry[] | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  // Lazy-load skills the first time the picker opens.
  useEffect(() => {
    if (!skillsOpen || skills !== null) return;
    let cancelled = false;
    void fetch("/api/agents/skills")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http ${r.status}`))))
      .then((data: { skills: SkillEntry[] }) => {
        if (!cancelled) setSkills(data.skills ?? []);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setSkills([]);
          setSkillsError(err.message);
        }
      });
    return () => { cancelled = true; };
  }, [skillsOpen, skills]);

  // Show writing-category system skills + all personal skills (which have no
  // category — they always appear in the rephrase picker). Personal skills
  // use their `description` as the display label and `instructions` as the
  // rephrase prompt (falling back to description if instructions are empty).
  const menuSkills = (skills ?? []).filter(
    (s) => s.category === "writing" || !s.category,
  );

  const isPortal = source === "portal";
  const placeholder = turns.length > 0
    ? isPortal ? "Refine the generated text…" : "Refine the rephrased text…"
    : isPortal ? "What should I write?" : "How should AI rewrite this?";

  return (
    <div
      className="flex flex-col gap-2 rounded-lg bg-background p-2 shadow-lg"
      style={{ maxWidth: maxWidth ?? "480px" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          resetToFormat();
        }
      }}
    >
      {mode !== "rephrase-done" && (
        <div
          data-testid="rephrase-prompt-row"
          className="flex items-center justify-center gap-2 px-2"
        >
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && mode === "rephrase-prompt") {
                e.preventDefault();
                submitPrompt();
              }
            }}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm outline-none"
            autoFocus
            disabled={mode === "rephrase-streaming"}
          />
          {mode === "rephrase-streaming" ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <button onClick={submitPrompt}
              className="rounded px-2 py-1 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90">
              Send
            </button>
          )}
        </div>
      )}
      {mode === "rephrase-prompt" && !isPortal && (
        <div
          data-testid="rephrase-pill-row"
          className="flex flex-wrap items-center justify-center gap-1 px-2"
        >
          {REPHRASE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => submitWithPrompt(p.instruction)}
              className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
            >
              {p.label}
            </button>
          ))}
          <Popover open={skillsOpen} onOpenChange={setSkillsOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
                  aria-label="Personal skill"
                >
                  <span aria-hidden="true" className="text-sm leading-none">⬡</span>
                  Personal skill
                </button>
              }
            />
            <PopoverContent
              side="bottom"
              align="end"
              sideOffset={8}
              className="z-[60] w-64 p-0"
            >
              <Command>
                <CommandInput placeholder="Search skills..." />
                <CommandList>
                  <CommandEmpty>
                    {skills === null
                      ? "Loading..."
                      : skillsError
                        ? `Failed to load: ${skillsError}`
                        : "No skills."}
                  </CommandEmpty>
                  {menuSkills.length > 0 && (
                    <CommandGroup>
                      {menuSkills.map((s) => (
                        <CommandItem
                          key={s.name}
                          value={`${s.title} ${s.name}`}
                          onSelect={() => {
                            setSkillsOpen(false);
                            submitWithPrompt(s.instruction);
                          }}
                        >
                          <span className="truncate">{s.title}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}
      {aiOutput && (
        <div className="max-h-60 overflow-y-auto text-sm whitespace-pre-wrap">{aiOutput}</div>
      )}
      {mode === "rephrase-done" && aiOutput && (
        <div className="flex items-center gap-1">
          {!isPortal && handleReplace && (
            <button onClick={handleReplace}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-accent">
              Replace
            </button>
          )}
          <button onClick={handleAppend}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-accent">
            <ArrowDown className="h-3 w-3" /> {isPortal ? "Insert" : "Append"}
          </button>
          <button onClick={handleRefine}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-accent">
            <RefreshCw className="h-3 w-3" /> Refine
          </button>
        </div>
      )}
      {mode === "rephrase-done" && (
        <span className="text-xs text-muted-foreground">Esc to dismiss</span>
      )}
    </div>
  );
}

export function AiBubbleMenu({
  editor,
  aiTriggerCount = 0,
}: {
  editor: TiptapEditor;
  aiTriggerCount?: number;
}) {
  const [mode, setMode] = useState<Mode>("format");
  const [prompt, setPrompt] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [aiOutput, setAiOutput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [source, setSource] = useState<Source>("bubble");
  const [portalPos, setPortalPos] = useState({ top: 0, left: 0 });
  const [portalMaxWidth, setPortalMaxWidth] = useState("480px");
  const abortRef = useRef<AbortController | null>(null);
  const selRef = useRef({ from: 0, to: 0 });
  const lastTriggerRef = useRef(0);
  const lineStartRef = useRef(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const resetToFormat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMode("format");
    setAiOutput("");
    setPrompt("");
    setTurns([]);
  }, []);

  // When slash command selects "AI", open generate mode as portal
  useEffect(() => {
    if (aiTriggerCount > lastTriggerRef.current) {
      lastTriggerRef.current = aiTriggerCount;
      const { from, to } = editor.state.selection;
      // Position anchored to the start of the line where `/` was typed
      const $pos = editor.state.doc.resolve(from);
      const lineStart = $pos.start();
      lineStartRef.current = lineStart;
      const coords = editor.view.coordsAtPos(lineStart);
      const editorEl = editor.view.dom as HTMLElement;
      const editorRect = editorEl.getBoundingClientRect();
      setPortalPos({
        top: coords.bottom + 4,
        left: Math.max(editorRect.left, coords.left),
      });
      setPortalMaxWidth(`${editorRect.width}px`);
      const { $from } = editor.state.selection;
      const paraText = $from.parent.textContent.trim();
      selRef.current = { from, to };
      setSelectedText(paraText);
      setAiOutput("");
      setPrompt("");
      setTurns([]);
      setSource("portal");
      setMode("rephrase-prompt");
      editor.commands.focus();
    }
  }, [aiTriggerCount, editor]);

  // Click-away dismissal for portal mode
  useEffect(() => {
    if (mode === "format" || source !== "portal") return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && panelRef.current.contains(e.target as Node)) return;
      resetToFormat();
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [mode, source, resetToFormat]);

  // Global Escape handler for portal mode
  const inRephrase = mode !== "format";
  const inBubbleRephrase = inRephrase && source === "bubble";
  const inPortalRephrase = inRephrase && source === "portal";

  // Selecting new text while in rephrase mode resets to format mode.
  useEffect(() => {
    const handler = () => {
      if (mode === "format") return;
      if (source === "portal") return;
      const { from, to } = editor.state.selection;
      if (from !== selRef.current.from || to !== selRef.current.to) {
        abortRef.current?.abort();
        abortRef.current = null;
        setMode("format");
        setAiOutput("");
        setPrompt("");
        setTurns([]);
      }
    };
    editor.on("selectionUpdate", handler);
    return () => { editor.off("selectionUpdate", handler); };
  }, [editor, mode, source]);

  const enterRephrase = useCallback(() => {
    const { from, to } = editor.state.selection;
    selRef.current = { from, to };
    setSelectedText(editor.state.doc.textBetween(from, to, "\n"));
    setAiOutput("");
    setPrompt("");
    setTurns([]);
    setSource("bubble");
    setMode("rephrase-prompt");
  }, [editor]);

  const submitWithPromptText = useCallback((promptText: string) => {
    const text = (promptText ?? "").trim();
    if (!text) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setMode("rephrase-streaming");
    setAiOutput("");

    const isGenerate = source === "portal";
    let context: string | undefined;
    if (isGenerate) {
      // Generation: no context, or paragraph context for continuation
      context = selectedText || undefined;
    } else if (turns.length > 0) {
      const history = turns
        .map((t, i) => `Turn ${i + 1} prompt: ${t.prompt}\nTurn ${i + 1} result: ${t.response}`)
        .join("\n\n");
      context = `Original text:\n${selectedText}\n\nPrevious rephrase history:\n${history}`;
    } else {
      context = selectedText || undefined;
    }

    let accumulated = "";
    void runSlashAi({
      prompt: text,
      context,
      mode: isGenerate ? "generate" : "rephrase",
      signal: controller.signal,
      onToken: (chunk) => { accumulated += chunk; setAiOutput(accumulated); },
      onError: (msg) => { setAiOutput((p) => p + ` [ai error: ${msg}]`); },
    }).catch(() => {}).finally(() => {
      setMode("rephrase-done");
      if (abortRef.current === controller) abortRef.current = null;
    });
  }, [selectedText, turns, source]);

  const submitPrompt = useCallback(() => {
    submitWithPromptText(prompt);
  }, [prompt, submitWithPromptText]);

  const handleReplace = useCallback(() => {
    const { from, to } = selRef.current;
    editor.chain().focus().deleteRange({ from, to }).insertContent(aiOutput).run();
    setMode("format");
    setTurns([]);
  }, [editor, aiOutput]);

  const handleAppend = useCallback(() => {
    editor.chain().focus().setTextSelection(selRef.current.to).insertContent(aiOutput).run();
    setMode("format");
    setTurns([]);
  }, [editor, aiOutput]);

  const handleRefine = useCallback(() => {
    setTurns((prev) => [...prev, { prompt, response: aiOutput }]);
    setAiOutput("");
    setPrompt("");
    setMode("rephrase-prompt");
  }, [prompt, aiOutput]);

  // Scroll-aware portal position — keeps panel anchored to the editor line
  useEffect(() => {
    if (!inPortalRephrase) return;
    const editorEl = editor.view.dom as HTMLElement;
    let rafId: number | null = null;
    const updatePos = () => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        try {
          const coords = editor.view.coordsAtPos(lineStartRef.current);
          const editorRect = editorEl.getBoundingClientRect();
          if (panelRef.current) {
            panelRef.current.style.top = `${coords.bottom + 4}px`;
            panelRef.current.style.left = `${Math.max(editorRect.left, coords.left)}px`;
          }
        } catch { /* position off-screen */ }
      });
    };
    window.addEventListener("scroll", updatePos, { passive: true });
    let scrollParent: HTMLElement | null = null;
    let parent = editorEl.parentElement;
    while (parent) {
      const { overflowY } = getComputedStyle(parent);
      if (overflowY === "auto" || overflowY === "scroll") { scrollParent = parent; break; }
      parent = parent.parentElement;
    }
    if (scrollParent) scrollParent.addEventListener("scroll", updatePos, { passive: true });
    return () => {
      window.removeEventListener("scroll", updatePos);
      if (scrollParent) scrollParent.removeEventListener("scroll", updatePos);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [inPortalRephrase, editor]);

  // Global Escape handler for portal mode
  useEffect(() => {
    if (!inPortalRephrase) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        resetToFormat();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [inPortalRephrase, resetToFormat]);

  return (
    <>
      <BubbleMenu
        editor={editor}
        shouldShow={({ state }) => {
          if (inBubbleRephrase) return true;
          if (inPortalRephrase) return false;
          const { from, to } = state.selection;
          return from !== to;
        }}
        tippyOptions={{
          placement: "top",
          interactive: true,
          popperOptions: {
            strategy: "fixed",
            modifiers: [
              { name: "flip", enabled: false },
              { name: "preventOverflow", enabled: false },
            ],
          },
          onHidden: () => {
            if (!inRephrase) resetToFormat();
          },
        }}
        className={
          inBubbleRephrase
            ? "rephrase-bubble"
            : "flex items-center divide-x divide-border rounded-lg border bg-background shadow-lg"
        }
      >
        {inBubbleRephrase ? (
          <RephrasePanel
            mode={mode}
            prompt={prompt}
            setPrompt={setPrompt}
            aiOutput={aiOutput}
            turns={turns}
            submitPrompt={submitPrompt}
            submitWithPrompt={submitWithPromptText}
            handleReplace={handleReplace}
            handleAppend={handleAppend}
            handleRefine={handleRefine}
            resetToFormat={resetToFormat}
            source={source}
          />
        ) : (
          <>
            <div className="flex items-center">
              <button onClick={() => editor.chain().focus().toggleBold().run()}
                className={`rounded-l-lg px-2 py-1.5 text-sm hover:bg-accent ${editor.isActive("bold") ? "bg-accent text-accent-foreground" : ""}`}>
                <Bold className="h-4 w-4" />
              </button>
              <button onClick={() => editor.chain().focus().toggleItalic().run()}
                className={`px-2 py-1.5 text-sm hover:bg-accent ${editor.isActive("italic") ? "bg-accent text-accent-foreground" : ""}`}>
                <Italic className="h-4 w-4" />
              </button>
              <button onClick={() => editor.chain().focus().toggleCode().run()}
                className={`px-2 py-1.5 text-sm hover:bg-accent ${editor.isActive("code") ? "bg-accent text-accent-foreground" : ""}`}>
                <Code className="h-4 w-4" />
              </button>
            </div>
            <button onClick={enterRephrase}
              className="flex items-center gap-1 rounded-r-lg px-2 py-1.5 text-sm hover:bg-accent">
              <span aria-hidden="true" className="text-sm leading-none">⬡</span>
              <span className="text-xs">AI Rephrase</span>
            </button>
          </>
        )}
      </BubbleMenu>

      {inPortalRephrase && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top: portalPos.top,
            left: portalPos.left,
            zIndex: 50,
          }}
        >
          <RephrasePanel
            mode={mode}
            prompt={prompt}
            setPrompt={setPrompt}
            aiOutput={aiOutput}
            turns={turns}
            submitPrompt={submitPrompt}
            submitWithPrompt={submitWithPromptText}
            handleAppend={handleAppend}
            handleRefine={handleRefine}
            resetToFormat={resetToFormat}
            source={source}
            maxWidth={portalMaxWidth}
          />
        </div>
      )}
    </>
  );
}