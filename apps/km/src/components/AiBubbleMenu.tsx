"use client";

import { BubbleMenu, type TiptapEditor } from "@episteme/editor";
import { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { runSlashAi } from "@/app/(app)/n/[slug]/run-slash-ai";
import type { SkillCategory } from "@/lib/skills";
import {
  Bold, Italic, Code, Loader2,
  ArrowDown, RefreshCw, Link as LinkIcon,
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
import { LinkPopover } from "@/components/LinkPopover";
import { MessageResponse } from "@/components/ai-elements/message";
import { mdToProseMirror, type JSONContent } from "@episteme/markdown";

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
  aiError,
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
  aiError: string;
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

  // Enter-to-send must be handled by a NATIVE keydown listener on the input,
  // not React's `onKeyDown` (GSD-170 real root cause). The rephrase input lives
  // inside the Tiptap BubbleMenu tippy popper, which — because tippy is
  // `interactive` with the default `appendTo` — mounts inside the editor's
  // key-isolation host (packages/editor Editor.tsx). That host runs a
  // BUBBLE-phase keydown listener (attachEditorKeyIsolation) that
  // `stopPropagation()`s every non-modifier key except Escape/Tab, Enter
  // included. React 19 delegates events at `document`, so the stopped keydown
  // never reaches React's root and the input's React `onKeyDown` never fires —
  // while the Send button's click is untouched. A native listener bound
  // directly on the input runs at the target phase, BEFORE the event bubbles up
  // to the host, so it fires reliably.
  //
  // A `ref` carries the latest mode/submit so the handler never goes stale.
  // A CALLBACK ref (not a plain ref + mount effect) attaches/detaches the
  // native listener, so it re-binds whenever the input element is remounted —
  // e.g. after "Refine", which unmounts and re-creates the input.
  //
  // The ref is refreshed in a layout effect (post-commit), not during render,
  // so a discarded concurrent render can't leak uncommitted mode/submit into
  // the handler. The native keydown only fires on real user interaction, always
  // after commit, so the committed value is what runs.
  const enterRef = useRef<{ mode: Mode; submit: () => void }>({ mode, submit: submitPrompt });
  useLayoutEffect(() => {
    enterRef.current = { mode, submit: submitPrompt };
  }, [mode, submitPrompt]);
  const inputCleanupRef = useRef<(() => void) | null>(null);
  const inputRef = useCallback((el: HTMLInputElement | null) => {
    inputCleanupRef.current?.();
    inputCleanupRef.current = null;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      // Match the Send button's availability: any non-streaming mode. Plain
      // Enter only; Shift+Enter is left alone. submitPrompt no-ops on an
      // empty/whitespace prompt, mirroring Send. stopPropagation keeps the key
      // from reaching the underlying editor.
      if (e.key === "Enter" && !e.shiftKey && enterRef.current.mode !== "rephrase-streaming") {
        e.preventDefault();
        e.stopPropagation();
        enterRef.current.submit();
      }
    };
    el.addEventListener("keydown", handler);
    inputCleanupRef.current = () => el.removeEventListener("keydown", handler);
  }, []);

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
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            // Enter-to-send is wired via a native keydown listener on this input
            // (see the effect above) — a React `onKeyDown` here never fires,
            // because the editor's key-isolation host stops keydown propagation
            // before it reaches React's document-level delegation root (GSD-170).
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
                            submitWithPrompt(s.instruction || s.description || "");
                          }}
                        >
                          <span className="truncate">{s.title || s.name}</span>
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
        <div className="max-h-60 overflow-y-auto text-sm">
          <MessageResponse>{aiOutput}</MessageResponse>
        </div>
      )}
      {aiError && (
        <p className="text-xs text-destructive whitespace-pre-wrap">
          {aiError}
        </p>
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
  const [linkOpen, setLinkOpen] = useState(false);
  const linkRangeRef = useRef<{ from: number; to: number } | null>(null);
  const [linkInitial, setLinkInitial] = useState({ text: "", href: "" });
  const [prompt, setPrompt] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [aiOutput, setAiOutput] = useState("");
  const [aiError, setAiError] = useState("");
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
    setAiError("");
    setPrompt("");
    setTurns([]);
  }, []);

  // When slash command selects "AI", open generate mode as a body-portaled
  // panel.
  //
  // GSD-134 (structural root cause): the rephrase panel must be a `createPortal`
  // into `document.body`, NOT a React sibling of <BubbleMenu>. `@tiptap/react`'s
  // BubbleMenu renders its children into a div that `@tiptap/extension-bubble-
  // menu` then `.remove()`s and reparents into a tippy popper — while React's
  // fiber tree still tracks that div where <BubbleMenu> was declared. If the
  // panel renders as a sibling of <BubbleMenu>, React's commit-phase placement
  // resolves the panel's host sibling to that relocated div and calls
  // `parent.insertBefore(panel, bubbleMenuDiv)`, which throws
  // `NotFoundError: ... not a child of this node` because the div is no longer a
  // child of `parent`. Body-portaling the panel removes it from that host-parent
  // sibling chain entirely. (Two prior timing fixes — queueMicrotask, double-RAF
  // — failed because the sibling relationship is invalid regardless of WHEN the
  // state update lands.)
  useEffect(() => {
    if (aiTriggerCount <= lastTriggerRef.current) return;
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
    setAiError("");

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
      // Errors render as plain text (see aiError below), never through the
      // markdown pipeline — otherwise brackets/underscores in the message get
      // reinterpreted as links/emphasis (GSD-170 codex review).
      onError: (msg) => { setAiError(`AI error: ${msg}`); },
    }).catch(() => {}).finally(() => {
      setMode("rephrase-done");
      if (abortRef.current === controller) abortRef.current = null;
    });
  }, [selectedText, turns, source]);

  const submitPrompt = useCallback(() => {
    submitWithPromptText(prompt);
  }, [prompt, submitWithPromptText]);

  // The AI output is markdown. Parse it into ProseMirror nodes via the app's
  // canonical pipeline (same one save-note-md uses) so `**bold**`, `# heading`,
  // `- list`, `[link](url)` land as real formatted nodes matching the preview —
  // not as literal markdown text (GSD-170 codex review). No HTML sanitization is
  // needed: createExtensions() configures tiptap-markdown with `html: false`, so
  // model-authored raw HTML renders as escaped text, never DOM nodes.
  //
  // `mdToProseMirror` returns a full `{ type: "doc", content: [...] }` node.
  // insertContent treats a `doc`-type node as a single opaque node and won't
  // spread its children into the live doc, so we pass the block-node array
  // (`.content`). If conversion throws (malformed/truncated model output), fall
  // back to the raw string so the user never loses their generated content —
  // mirrors the degrade-gracefully pattern in lib/notes/save-note-md.ts.
  const aiOutputAsContent = useCallback((): JSONContent[] | string => {
    try {
      return mdToProseMirror(aiOutput).content ?? aiOutput;
    } catch {
      return aiOutput;
    }
  }, [aiOutput]);

  const handleReplace = useCallback(() => {
    const { from, to } = selRef.current;
    editor.chain().focus().deleteRange({ from, to }).insertContent(aiOutputAsContent()).run();
    setMode("format");
    setTurns([]);
  }, [editor, aiOutputAsContent]);

  const handleAppend = useCallback(() => {
    editor.chain().focus().setTextSelection(selRef.current.to).insertContent(aiOutputAsContent()).run();
    setMode("format");
    setTurns([]);
  }, [editor, aiOutputAsContent]);

  const openLink = useCallback(() => {
    const { from, to } = editor.state.selection;
    linkRangeRef.current = { from, to };
    const selectedText = editor.state.doc.textBetween(from, to, "");
    setLinkInitial({ text: selectedText, href: "" });
    setLinkOpen(true);
  }, [editor]);

  const insertLink = useCallback(
    ({ text, href }: { text: string; href: string }) => {
      const range = linkRangeRef.current;
      if (!range) return;
      editor
        .chain()
        .focus()
        .setTextSelection(range)
        .deleteSelection()
        .insertContent({
          type: "text",
          text,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
      setLinkOpen(false);
      linkRangeRef.current = null;
    },
    [editor],
  );

  const cancelLink = useCallback(() => {
    setLinkOpen(false);
    linkRangeRef.current = null;
  }, []);

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
          // While the link popover overlay is open, dismiss the formatting
          // toolbar so it doesn't overlap the popover (GSD-224a). Mirrors the
          // inPortalRephrase early-return above.
          if (linkOpen) return false;
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
            aiError={aiError}
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
              <button
                onClick={openLink}
                aria-label="Insert link"
                className={`px-2 py-1.5 text-sm hover:bg-accent ${editor.isActive("link") ? "bg-accent text-accent-foreground" : ""}`}
              >
                <LinkIcon className="h-4 w-4" />
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

      {linkOpen && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-32" onMouseDown={(e) => { if (e.target === e.currentTarget) cancelLink(); }}>
          <LinkPopover
            initialText={linkInitial.text}
            initialHref={linkInitial.href}
            onSave={insertLink}
            onCancel={cancelLink}
          />
        </div>,
        document.body,
      )}

      {inPortalRephrase && typeof document !== "undefined" && createPortal(
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
            aiError={aiError}
            turns={turns}
            submitPrompt={submitPrompt}
            submitWithPrompt={submitWithPromptText}
            handleAppend={handleAppend}
            handleRefine={handleRefine}
            resetToFormat={resetToFormat}
            source={source}
            maxWidth={portalMaxWidth}
          />
        </div>,
        document.body,
      )}
    </>
  );
}