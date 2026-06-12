"use client";

// GSD-96 R3 — chat composer with @-mention picker + library-handle support
// + composer drop zone.
//
// Implementation note (deviation from plan §3B step 1-4 noted in §11):
// Ships as a textarea-backed composer w/ a popover @-picker (mirroring the
// AgentBall "LITE" picker pattern in §3.7), NOT a Tiptap single-line. We
// still emit library-handle tokens via formatLibToken so the agent
// middleware (R2) processes them identically. The Tiptap upgrade can land
// in a follow-up round once the token round-trip is proven end-to-end.
//
// Surface contracts:
//   - onSubmit({text}) called on Enter (no shift). Text includes
//     interleaved [lib: ...] tokens for any inserted library handles.
//   - useDroppable("chat-composer") registers a drop target for
//     SidebarDragActive payloads — DndContext lives at the (app) root
//     (R2 hoist).
//   - During streaming, submit is suppressed (matches AgentTranscript).

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
  type KeyboardEvent,
} from "react";
import { useDroppable, useDndMonitor, type DragEndEvent } from "@dnd-kit/core";
import { Textarea } from "@/components/ui/textarea";
import { formatLibraryHandles, type LibraryHandle, type LibraryKind } from "@/lib/agent/lib-tokens";

export interface ChatComposerSubmitPayload {
  text: string;
  handles: LibraryHandle[];
}

export interface ChatComposerProps {
  onSubmit: (payload: ChatComposerSubmitPayload) => void;
  streaming: boolean;
  placeholder?: string;
  initialText?: string;
}

export interface ChatComposerHandle {
  /** Insert a library handle from a drop or external picker. */
  insertHandle: (handle: LibraryHandle) => void;
  /** Get current text (with library tokens interleaved). */
  getText: () => string;
  /** Fire the same submit path Enter triggers (external Send button). */
  submit: () => void;
  /** True when there's no text + no handles (drives Send button disabled). */
  isEmpty: () => boolean;
}

// Helper exported for tests + drop-target use. Returns the textual
// [lib: ...] token for a single handle.
export function insertLibraryHandle(handle: LibraryHandle): string {
  return formatLibraryHandles([handle]);
}

/**
 * Decode a SidebarDragActive-shaped payload into a LibraryHandle if it can
 * be dropped on the chat composer. Returns null for non-leaf, folder, or
 * shaped-wrong payloads so the caller can ignore them. Exported for tests.
 */
export function decodeDropPayload(
  data: unknown,
): LibraryHandle | null {
  if (!data || typeof data !== "object") return null;
  const d = data as {
    kind?: string;
    itemKind?: string;
    id?: string;
    title?: string;
  };
  if (d.kind !== "leaf") return null;
  if (!d.id || !d.itemKind) return null;
  if (
    d.itemKind !== "paper" &&
    d.itemKind !== "note" &&
    d.itemKind !== "reference" &&
    d.itemKind !== "paperset"
  ) {
    return null;
  }
  return {
    kind: d.itemKind,
    id: d.id,
    title: d.title ?? d.itemKind,
  };
}

interface RecentItem {
  id: string;
  kind: LibraryKind;
  title: string;
}

interface SearchHit {
  id: string;
  kind: LibraryKind;
  title: string;
}

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
  function ChatComposer(
    { onSubmit, streaming, placeholder = "Ask anything", initialText = "" },
    ref,
  ) {
    const [text, setText] = useState(initialText);
    const [handles, setHandles] = useState<LibraryHandle[]>([]);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");
    const [pickerAt, setPickerAt] = useState<number | null>(null);
    const [items, setItems] = useState<SearchHit[]>([]);
    const [selected, setSelected] = useState(0);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    // Droppable surface for SidebarDragActive payloads (R2 type).
    const { setNodeRef, isOver } = useDroppable({ id: "chat-composer" });

    // Listen to drag-end events at the outer DndContext (AppDndContext from
    // the (app) layout). When a SidebarDragActive lands on us, decode the
    // payload + insert it as a library handle chip.
    useDndMonitor({
      onDragEnd(ev: DragEndEvent) {
        if (ev.over?.id !== "chat-composer") return;
        const handle = decodeDropPayload(ev.active?.data?.current);
        if (handle) appendHandle(handle);
      },
    });

    useImperativeHandle(
      ref,
      () => ({
        insertHandle: (handle: LibraryHandle) => {
          appendHandle(handle);
        },
        getText: () => composeOutput(text, handles),
        submit: () => handleSubmit(),
        isEmpty: () => text.trim().length === 0 && handles.length === 0,
      }),
      [text, handles],
    );

    // Watch for `@` and open the picker.
    useEffect(() => {
      const at = pickerAt;
      if (at === null) return;
      const q = text.slice(at + 1).match(/^[^\s@]*/)?.[0] ?? "";
      setPickerQuery(q);
    }, [text, pickerAt]);

    // Load items as query changes.
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
            const arr = (data.items ?? []) as RecentItem[];
            setItems(arr.map((it) => ({ id: it.id, kind: it.kind, title: it.title })));
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
            setItems(merged.slice(0, 10));
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

    function appendHandle(handle: LibraryHandle) {
      setHandles((h) => [...h, handle]);
      // Replace the typed `@query` (if any) with empty so the textarea
      // doesn't keep a stale literal `@foo`.
      if (pickerAt !== null) {
        setText((cur) => cur.slice(0, pickerAt) + cur.slice(pickerAt + 1 + pickerQuery.length));
      }
      setPickerOpen(false);
      setPickerAt(null);
      setPickerQuery("");
    }

    function handleSubmit() {
      if (streaming) return;
      const composed = composeOutput(text, handles);
      if (composed.trim().length === 0 && handles.length === 0) return;
      onSubmit({ text: composed, handles });
      setText("");
      setHandles([]);
    }

    function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
      if (pickerOpen && items.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelected((s) => (s + 1) % items.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelected((s) => (s + items.length - 1) % items.length);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const it = items[selected];
          if (it) appendHandle({ kind: it.kind, id: it.id, title: it.title });
          return;
        }
        if (e.key === "Escape") {
          setPickerOpen(false);
          setPickerAt(null);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    }

    function onChange(value: string) {
      setText(value);
      // Detect a new `@` insertion at the caret position.
      const caret = textareaRef.current?.selectionStart ?? value.length;
      const prev = value.slice(Math.max(0, caret - 1), caret);
      if (prev === "@") {
        setPickerAt(caret - 1);
        setPickerOpen(true);
        setPickerQuery("");
      }
    }

    return (
      <div
        ref={setNodeRef}
        data-testid="chat-composer"
        className={`relative ${isOver ? "ring-1 ring-primary/40 ring-inset" : ""}`}
      >
        {handles.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-2 pt-2" data-testid="chat-composer-handles">
            {handles.map((h, i) => (
              <span
                key={`${h.kind}-${h.id}-${i}`}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
              >
                <span className="text-muted-foreground">{h.kind}</span>
                <span>{h.title}</span>
                <button
                  type="button"
                  aria-label={`Remove ${h.title}`}
                  onClick={() => setHandles((cur) => cur.filter((_, idx) => idx !== i))}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <Textarea
          ref={textareaRef}
          autoFocus
          aria-label="Message agent"
          className="min-h-9 max-h-48 resize-none py-1.5 text-sm"
          placeholder={placeholder}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          rows={1}
        />
        {pickerOpen ? (
          <Picker items={items} selected={selected} onPick={appendHandle} />
        ) : null}
      </div>
    );
  },
);

function composeOutput(text: string, handles: LibraryHandle[]): string {
  const tokens = formatLibraryHandles(handles);
  if (tokens.length === 0) return text;
  return text.length > 0 ? `${text} ${tokens}` : tokens;
}

function Picker({
  items,
  selected,
  onPick,
}: {
  items: SearchHit[];
  selected: number;
  onPick: (h: LibraryHandle) => void;
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
                    onPick({ kind: it.kind, id: it.id, title: it.title });
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
