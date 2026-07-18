"use client";

// GSD-105 (R6 of GSD-96) — Tiptap chat composer with truly inline
// wikilink-style chips.
//
// Replaces the R3 textarea + out-of-flow handles row. The wikiLink atom
// node ships from @episteme/markdown (same node + styling as the notes
// editor), inserted via the @-trigger Suggestion plugin OR the ref-based
// imperative API. Submit serializes the doc in DFS order and emits
// `[lib: kind=... id=... title="..."]` tokens at the EXACT positions where
// chips sit so a prompt like "look at @paper then summarise" produces
// `look at [lib: ...] then summarise` — text + tokens INTERLEAVED.
//
// Drop-target wiring (R3/R4 composer drop) is parked under
// apps/km/src/lib/agent/_deferred/finder-routing/. Cmd+V image paste is
// deferred to GSD-106.
//
// Surface contract:
//   - onSubmit({ text, handles }): text is the ordered string. handles
//     is the flat array of inserted library handles (for callers that
//     still need it, though the agent middleware now parses tokens
//     directly out of `text`).
//   - streaming=true → submit no-op.
//   - ChatComposerHandle.submit() / insertHandle() / isEmpty() / getText()
//     keep parity with the R3 API so AgentTranscript wiring is unchanged.
//   - `_editor` is exposed for tests to drive the editor directly.

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  EditorContent,
  chatEditorExtensions,
  serializeChatDoc,
  isChatDocEmpty,
  useEditor,
  type ChatWikiLinkSuggestion,
  type TiptapEditor,
} from "@episteme/editor";
import { formatLibraryHandles, type LibraryHandle, type LibraryKind } from "@/lib/agent/lib-tokens";
import { orderHitsForDisplay } from "./chat-mention-order";

export interface ChatComposerSubmitPayload {
  text: string;
  handles: LibraryHandle[];
}

export interface ChatComposerProps {
  onSubmit: (payload: ChatComposerSubmitPayload) => void;
  streaming: boolean;
  placeholder?: string;
  initialText?: string;
  /** Fires when emptiness changes — used by the outer Send button to
   *  flip `disabled` (GSD-105 fix-round Fix 3). Called once on mount and
   *  on every editor update; also called after submit clears the doc. */
  onIsEmptyChange?: (isEmpty: boolean) => void;
}

export interface ChatComposerHandle {
  /** Insert a library handle from a drop or external picker. */
  insertHandle: (handle: LibraryHandle) => void;
  /** Insert a "@" at the cursor to open the library mention picker (GSD-129).
   *  Used by the paper-clip button so it triggers the SAME @-mention flow as
   *  typing "@" by hand. */
  insertAtMention: () => void;
  /** Get current text (with library tokens interleaved). */
  getText: () => string;
  /** Fire the same submit path Enter triggers (external Send button). */
  submit: () => void;
  /** True when there's no text + no chips. */
  isEmpty: () => boolean;
  /** Test hook: raw Tiptap editor instance. */
  _editor: TiptapEditor | null;
}

interface SearchHit {
  id: string;
  kind: LibraryKind;
  title: string;
}

function formatLibToken(h: { kind: string; id: string; title: string }): string {
  // Funnel through formatLibraryHandles so the grammar stays the single
  // source of truth (lib-tokens.ts).
  return formatLibraryHandles([
    { kind: h.kind as LibraryKind, id: h.id, title: h.title },
  ]);
}

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
  function ChatComposer(
    { onSubmit, streaming, placeholder = "Ask anything", onIsEmptyChange },
    ref,
  ) {
    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;
    const streamingRef = useRef(streaming);
    streamingRef.current = streaming;
    const onIsEmptyChangeRef = useRef(onIsEmptyChange);
    onIsEmptyChangeRef.current = onIsEmptyChange;

    // Picker popover state (mirror of R3 picker — Tiptap suggestion
    // delivers the query + range, we render the same listbox inline).
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");
    const [items, setItems] = useState<SearchHit[]>([]);
    const [selected, setSelected] = useState(0);
    const itemsRef = useRef<SearchHit[]>([]);
    const selectedRef = useRef(0);
    itemsRef.current = items;
    selectedRef.current = selected;
    const suggestionCommandRef = useRef<((props: unknown) => void) | null>(null);

    const trySubmit = useCallback(() => {
      const e = editorRef.current;
      if (!e) return false;
      if (streamingRef.current) return false;
      if (isChatDocEmpty(e.state.doc)) return false;
      const text = serializeChatDoc(e.state.doc, formatLibToken);
      if (!text.trim() && !text.includes("[lib:")) return false;
      // Re-derive flat handle list from the doc for callers that still
      // want the typed array (agent middleware parses tokens out of text
      // either way).
      const handles: LibraryHandle[] = [];
      e.state.doc.descendants((n) => {
        if (n.type.name === "wikiLink") {
          const a = n.attrs as {
            targetKind: LibraryKind | null;
            targetId: string | null;
            title: string;
            displayTitle: string | null;
            alias: string | null;
          };
          if (a.targetKind && a.targetId) {
            handles.push({
              kind: a.targetKind as LibraryKind,
              id: a.targetId,
              title: a.displayTitle ?? a.alias ?? a.title ?? "",
            });
          }
        }
      });
      onSubmitRef.current({ text, handles });
      e.commands.clearContent();
      // Editor `update` event does not fire reliably from inside the same
      // synchronous tick as the clearContent command (Tiptap batches
      // transactions); push the empty notification explicitly so the outer
      // Send button re-disables immediately after submit (Fix 3).
      onIsEmptyChangeRef.current?.(true);
      return true;
    }, []);

    const wikiLinkSuggestion = useMemo<ChatWikiLinkSuggestion>(
      () => ({
        items: async ({ query }) => {
          // Items come from the popover's fetcher (effect below). The
          // suggestion plugin only needs *some* array; the popover handles
          // the keyboard + click. We return an empty list and let the
          // host-rendered picker drive selection.
          void query;
          return [];
        },
        command: ({ editor, range, props }) => {
          const p = props as {
            title: string;
            targetKind: LibraryKind;
            targetId: string | null;
          };
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: "wikiLink",
                attrs: {
                  title: p.title,
                  alias: null,
                  targetKind: p.targetKind,
                  targetId: p.targetId,
                  displayTitle: null,
                },
              },
              { type: "text", text: " " },
            ])
            .run();
        },
        render: () => {
          let host: HTMLDivElement | null = null;
          let root: Root | null = null;
          const place = (
            clientRect: (() => DOMRect | null) | null | undefined,
            ed: TiptapEditor,
            range: { from: number; to: number },
          ) => {
            if (!host) return;
            let rect = clientRect?.() ?? null;
            if (!rect) {
              try {
                const c = ed.view.coordsAtPos(range.from);
                rect = {
                  top: c.top,
                  bottom: c.bottom,
                  left: c.left,
                  right: c.left,
                  width: 0,
                  height: c.bottom - c.top,
                  x: c.left,
                  y: c.top,
                  toJSON: () => ({}),
                } as DOMRect;
              } catch {
                host.style.display = "none";
                return;
              }
            }
            host.style.display = "block";
            // Tiptap suggestion popover floats above the caret; place by
            // estimating 240px popover height.
            const POPOVER_H = 240;
            const top = rect.top + window.scrollY - POPOVER_H - 4;
            host.style.top = `${Math.max(window.scrollY + 4, top)}px`;
            host.style.left = `${rect.left + window.scrollX}px`;
          };
          return {
            onStart: (props) => {
              suggestionCommandRef.current = props.command as never;
              host = document.createElement("div");
              host.style.position = "absolute";
              host.style.zIndex = "50";
              host.setAttribute("data-testid", "chat-composer-picker-anchor");
              document.body.appendChild(host);
              root = createRoot(host);
              setPickerQuery(props.query ?? "");
              setPickerOpen(true);
              place(props.clientRect, props.editor, props.range);
            },
            onUpdate: (props) => {
              setPickerQuery(props.query ?? "");
              place(props.clientRect, props.editor, props.range);
            },
            onKeyDown: (props) => {
              if (!pickerOpenRef.current) return false;
              const k = props.event.key;
              if (k === "ArrowDown") {
                props.event.preventDefault();
                setSelected((s) => (s + 1) % Math.max(1, itemsRef.current.length));
                return true;
              }
              if (k === "ArrowUp") {
                props.event.preventDefault();
                setSelected(
                  (s) =>
                    (s + itemsRef.current.length - 1) %
                    Math.max(1, itemsRef.current.length),
                );
                return true;
              }
              if (k === "Enter") {
                props.event.preventDefault();
                const it = itemsRef.current[selectedRef.current];
                if (it && suggestionCommandRef.current) {
                  suggestionCommandRef.current({
                    title: it.title,
                    targetKind: it.kind,
                    targetId: it.id,
                  });
                }
                return true;
              }
              if (k === "Escape") {
                setPickerOpen(false);
                return true;
              }
              return false;
            },
            onExit: () => {
              setPickerOpen(false);
              if (root) root.unmount();
              if (host && host.parentNode) host.parentNode.removeChild(host);
              host = null;
              root = null;
              suggestionCommandRef.current = null;
            },
          };
        },
      }),
      [],
    );

    const editor = useEditor({
      extensions: chatEditorExtensions({
        placeholder,
        wikiLinkSuggestion,
      }),
      autofocus: true,
      immediatelyRender: false,
      onUpdate: ({ editor: ed }) => {
        // Notify the outer Send button of emptiness changes (Fix 3).
        onIsEmptyChangeRef.current?.(isChatDocEmpty(ed.state.doc));
      },
      onCreate: ({ editor: ed }) => {
        // Fire once at mount so the initial Send-button state matches doc
        // emptiness (typically `true`).
        onIsEmptyChangeRef.current?.(isChatDocEmpty(ed.state.doc));
      },
      editorProps: {
        attributes: {
          "aria-label": "Message agent",
          "data-testid": "chat-composer-editor",
          // Single-line vibe + matches the prior textarea sizing.
          class:
            "episteme-chat-composer outline-none min-h-9 max-h-48 overflow-y-auto py-1.5 px-2 text-sm",
        },
        handleKeyDown(view, event) {
          // Enter (no shift, no picker) → submit.
          if (event.key === "Enter" && !event.shiftKey) {
            // If the suggestion popover is open, let its onKeyDown run.
            if (pickerOpenRef.current) return false;
            event.preventDefault();
            trySubmit();
            return true;
          }
          return false;
        },
      },
    });

    const editorRef = useRef<TiptapEditor | null>(null);
    editorRef.current = editor;
    const pickerOpenRef = useRef(false);
    pickerOpenRef.current = pickerOpen;

    // Fire initial onIsEmptyChange once the editor instance materializes.
    // `useEditor({ immediatelyRender: false })` defers editor creation past
    // the first render, and Tiptap's `onCreate` callback does not fire
    // reliably in jsdom under that setting; this effect closes the gap so
    // the outer Send button starts in the correct disabled state.
    useEffect(() => {
      if (!editor) return;
      onIsEmptyChangeRef.current?.(isChatDocEmpty(editor.state.doc));
    }, [editor]);

    useImperativeHandle(
      ref,
      () => ({
        insertHandle: (handle: LibraryHandle) => {
          const e = editorRef.current;
          if (!e) return;
          e.chain()
            .focus()
            .insertContent({
              type: "wikiLink",
              attrs: {
                title: handle.title,
                alias: null,
                targetKind: handle.kind,
                targetId: handle.id,
                displayTitle: null,
              },
            })
            .run();
        },
        insertAtMention: () => {
          const e = editorRef.current;
          if (!e) return;
          // The @-trigger Suggestion plugin only matches when "@" sits at a
          // valid boundary: start-of-line, or after whitespace inside a single
          // text node (default `allowedPrefixes`). findSuggestionMatch reads
          // `$from.nodeBefore`, so a bare "@" only triggers when nodeBefore is
          // null (block start) or a text node ending in whitespace. Prepend a
          // space in every other case — covers cursor-after-word AND
          // cursor-after-chip (a wikiLink atom, where nodeBefore.isText is
          // false and a bare "@" would never open the picker).
          const before = e.state.selection.$from.nodeBefore;
          const endsInSpace =
            !!before && before.isText && /\s$/.test(before.text ?? "");
          const needsSpace = !!before && !endsInSpace;
          e.chain()
            .focus()
            .insertContent(needsSpace ? " @" : "@")
            .run();
        },
        getText: () => {
          const e = editorRef.current;
          if (!e) return "";
          return serializeChatDoc(e.state.doc, formatLibToken);
        },
        submit: () => {
          trySubmit();
        },
        isEmpty: () => {
          const e = editorRef.current;
          if (!e) return true;
          return isChatDocEmpty(e.state.doc);
        },
        get _editor() {
          return editorRef.current;
        },
      }),
      [trySubmit],
    );

    // Load picker items as the query changes.
    useEffect(() => {
      if (!pickerOpen) return;
      let cancelled = false;
      const q = pickerQuery.trim();
      const url =
        q.length === 0
          ? "/api/library/recents?limit=10"
          : `/api/wiki-link/search?q=${encodeURIComponent(q)}`;
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled || !data) return;
          if (q.length === 0) {
            const arr = (data.items ?? []) as Array<{
              id: string;
              kind: LibraryKind;
              title: string;
            }>;
            // GSD-152: pre-order into the Picker's grouped visual order so
            // flat index == visual row and ArrowDown/Up stay linear.
            setItems(
              orderHitsForDisplay(
                arr.map((it) => ({ id: it.id, kind: it.kind, title: it.title })),
              ),
            );
          } else {
            const merged: SearchHit[] = [];
            for (const p of data.papers ?? []) {
              merged.push({ id: p.id, kind: "paper", title: p.title });
            }
            for (const n of data.notes ?? []) {
              merged.push({ id: n.id, kind: "note", title: n.title });
            }
            for (const r of data.references ?? []) {
              merged.push({ id: r.id, kind: "reference", title: r.title });
            }
            // GSD-152: same grouped visual order as the recents branch.
            setItems(orderHitsForDisplay(merged.slice(0, 10)));
          }
          setSelected(0);
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        });
      return () => {
        cancelled = true;
      };
    }, [pickerOpen, pickerQuery]);

    const onPick = useCallback((it: SearchHit) => {
      if (suggestionCommandRef.current) {
        suggestionCommandRef.current({
          title: it.title,
          targetKind: it.kind,
          targetId: it.id,
        } as never);
      }
    }, []);

    return (
      <div data-testid="chat-composer" className="relative">
        <EditorContent editor={editor} />
        {pickerOpen ? (
          <Picker items={items} selected={selected} onPick={onPick} />
        ) : null}
      </div>
    );
  },
);

function Picker({
  items,
  selected,
  onPick,
}: {
  items: SearchHit[];
  selected: number;
  onPick: (it: SearchHit) => void;
}) {
  const grouped = useMemo(() => {
    const g: Record<LibraryKind, SearchHit[]> = {
      paper: [],
      note: [],
      reference: [],
      paperset: [],
    };
    for (const it of items) g[it.kind].push(it);
    return g;
  }, [items]);
  return (
    <div
      role="listbox"
      data-testid="chat-composer-picker"
      className="absolute bottom-full left-2 z-50 mb-1 min-w-[260px] rounded-md border bg-popover p-1 text-sm shadow-md"
    >
      {(["paper", "note", "reference", "paperset"] as const).map((kind) => {
        const rows = grouped[kind];
        if (rows.length === 0) return null;
        return (
          <div key={kind} className="mb-1 last:mb-0">
            <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase text-muted-foreground">
              {kind}
            </div>
            {rows.map((it) => {
              const flatIdx = items.indexOf(it);
              const isSel = flatIdx === selected;
              return (
                <button
                  key={`${kind}-${it.id}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(it);
                  }}
                  className={`w-full rounded px-2 py-1 text-left ${
                    isSel ? "bg-accent text-accent-foreground" : ""
                  }`}
                >
                  {it.title}
                </button>
              );
            })}
          </div>
        );
      })}
      {items.length === 0 ? (
        <div className="px-2 py-1 text-muted-foreground">No results</div>
      ) : null}
    </div>
  );
}
