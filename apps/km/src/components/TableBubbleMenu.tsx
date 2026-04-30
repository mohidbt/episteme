"use client";

import type { TiptapEditor } from "@episteme/editor";
import {
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
  Rows3,
  Columns3,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Rect {
  top: number;
  left: number;
  width: number;
}

/**
 * Pure decision: should the table menu be visible given the current signals?
 * Notion-style: visible if selection is inside a table, or the pointer is over
 * the table or the menu itself. Otherwise hidden (callers apply a debounce
 * grace period before transitioning visible -> hidden so the user can move the
 * cursor across the gap between table and floating menu).
 */
export function shouldShowTableMenu(s: {
  selectionInTable: boolean;
  pointerOnTable: boolean;
  pointerOnMenu: boolean;
}): boolean {
  return s.selectionInTable || s.pointerOnTable || s.pointerOnMenu;
}

const HIDE_GRACE_MS = 150;
const MENU_HEIGHT_OFFSET = 44;

export function TableBubbleMenu({ editor }: { editor: TiptapEditor }) {
  const [rect, setRect] = useState<Rect | null>(null);

  // Refs hold the latest signals so the rAF/timeout closures always see fresh
  // values without re-binding. This avoids stale-closure flicker.
  const tableRef = useRef<HTMLElement | null>(null);
  const selectionInTableRef = useRef(false);
  const pointerOnTableRef = useRef(false);
  const pointerOnMenuRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const computeRect = useCallback((el: HTMLElement): Rect => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top + window.scrollY,
      left: r.left + window.scrollX,
      width: r.width,
    };
  }, []);

  const recompute = useCallback(() => {
    const visible = shouldShowTableMenu({
      selectionInTable: selectionInTableRef.current,
      pointerOnTable: pointerOnTableRef.current,
      pointerOnMenu: pointerOnMenuRef.current,
    });

    if (visible) {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      const t = tableRef.current;
      if (t) setRect(computeRect(t));
    } else {
      if (hideTimerRef.current) return;
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null;
        // Re-check after grace; pointer may have entered the menu meanwhile.
        const stillVisible = shouldShowTableMenu({
          selectionInTable: selectionInTableRef.current,
          pointerOnTable: pointerOnTableRef.current,
          pointerOnMenu: pointerOnMenuRef.current,
        });
        if (!stillVisible) {
          tableRef.current = null;
          setRect(null);
        } else {
          const t = tableRef.current;
          if (t) setRect(computeRect(t));
        }
      }, HIDE_GRACE_MS);
    }
  }, [computeRect]);

  // --- Selection-driven signal (Notion's primary trigger) ---
  useEffect(() => {
    const updateFromSelection = () => {
      const inTable = editor.isActive("table");
      selectionInTableRef.current = inTable;
      if (inTable) {
        // Find the <table> DOM containing the current selection.
        const { from } = editor.state.selection;
        const dom = editor.view.domAtPos(from)?.node as Node | undefined;
        const start =
          dom && dom.nodeType === 1
            ? (dom as HTMLElement)
            : (dom?.parentElement ?? null);
        const tableEl = start?.closest?.("table") as HTMLElement | null;
        if (tableEl) tableRef.current = tableEl;
      }
      recompute();
    };

    updateFromSelection();
    editor.on("selectionUpdate", updateFromSelection);
    editor.on("transaction", updateFromSelection);
    return () => {
      editor.off("selectionUpdate", updateFromSelection);
      editor.off("transaction", updateFromSelection);
    };
  }, [editor, recompute]);

  // --- Pointer-over-table signal ---
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;

    const onMouseOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(
        "table",
      ) as HTMLElement | null;
      if (el && dom.contains(el)) {
        tableRef.current = el;
        pointerOnTableRef.current = true;
        recompute();
      }
    };

    const onMouseOut = (e: MouseEvent) => {
      const t = tableRef.current;
      if (!t) return;
      const related = e.relatedTarget as Node | null;
      // Pointer left the table (and didn't move to a child of it).
      if (!related || !t.contains(related)) {
        pointerOnTableRef.current = false;
        recompute();
      }
    };

    dom.addEventListener("mouseover", onMouseOver);
    dom.addEventListener("mouseout", onMouseOut);
    return () => {
      dom.removeEventListener("mouseover", onMouseOver);
      dom.removeEventListener("mouseout", onMouseOut);
    };
  }, [editor, recompute]);

  // Reposition on scroll/resize while visible.
  useEffect(() => {
    if (!rect) return;
    const onScrollOrResize = () => {
      const t = tableRef.current;
      if (t) setRect(computeRect(t));
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [rect, computeRect]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!rect) return null;

  // Buttons: preventDefault on mouseDown so the editor's selection (and thus
  // selectionInTable) is not lost when clicking — this is THE fix for the
  // "menu disappears the moment I click a button" bug.
  const stopBlur = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const toolbar = (
    <div
      data-testid="table-bubble-menu"
      style={{
        position: "absolute",
        top: rect.top - MENU_HEIGHT_OFFSET,
        left: rect.left + rect.width / 2,
        transform: "translateX(-50%)",
        zIndex: 50,
      }}
      onMouseEnter={() => {
        pointerOnMenuRef.current = true;
        recompute();
      }}
      onMouseLeave={() => {
        pointerOnMenuRef.current = false;
        recompute();
      }}
      onMouseDown={stopBlur}
      className="flex items-center gap-0.5 rounded-lg border bg-background p-1 shadow-lg"
    >
      <button
        type="button"
        title="Add row above"
        onMouseDown={stopBlur}
        onClick={() => editor.chain().focus().addRowBefore().run()}
        className="rounded p-1.5 text-sm hover:bg-accent"
      >
        <ArrowUpToLine className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Add row below"
        onMouseDown={stopBlur}
        onClick={() => editor.chain().focus().addRowAfter().run()}
        className="rounded p-1.5 text-sm hover:bg-accent"
      >
        <ArrowDownToLine className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Add column left"
        onMouseDown={stopBlur}
        onClick={() => editor.chain().focus().addColumnBefore().run()}
        className="rounded p-1.5 text-sm hover:bg-accent"
      >
        <ArrowLeftToLine className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Add column right"
        onMouseDown={stopBlur}
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        className="rounded p-1.5 text-sm hover:bg-accent"
      >
        <ArrowRightToLine className="h-4 w-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <button
        type="button"
        title="Delete row"
        onMouseDown={stopBlur}
        onClick={() => editor.chain().focus().deleteRow().run()}
        className="flex items-center rounded p-1.5 text-sm text-destructive hover:bg-destructive/10"
      >
        <span className="mr-0.5 text-xs font-medium">−</span>
        <Rows3 className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Delete column"
        onMouseDown={stopBlur}
        onClick={() => editor.chain().focus().deleteColumn().run()}
        className="flex items-center rounded p-1.5 text-sm text-destructive hover:bg-destructive/10"
      >
        <span className="mr-0.5 text-xs font-medium">−</span>
        <Columns3 className="h-4 w-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <button
        type="button"
        title="Delete table"
        onMouseDown={stopBlur}
        onClick={() => editor.chain().focus().deleteTable().run()}
        className="rounded p-1.5 text-sm text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );

  return createPortal(toolbar, document.body);
}
