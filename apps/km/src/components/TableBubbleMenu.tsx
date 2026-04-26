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
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Rect { top: number; left: number; width: number }

export function TableBubbleMenu({ editor }: { editor: TiptapEditor }) {
  const [rect, setRect] = useState<Rect | null>(null);
  const tableRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;

    const onMouseOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("table") as HTMLElement | null;
      if (el && dom.contains(el)) {
        tableRef.current = el;
        const r = el.getBoundingClientRect();
        setRect({ top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width });
      }
    };

    const onMouseOut = (e: MouseEvent) => {
      if (
        tableRef.current &&
        !tableRef.current.contains(e.relatedTarget as Node | null)
      ) {
        tableRef.current = null;
        setRect(null);
      }
    };

    dom.addEventListener("mouseover", onMouseOver);
    dom.addEventListener("mouseout", onMouseOut);
    return () => {
      dom.removeEventListener("mouseover", onMouseOver);
      dom.removeEventListener("mouseout", onMouseOut);
    };
  }, [editor]);

  if (!rect) return null;

  const toolbar = (
    <div
      style={{
        position: "absolute",
        top: rect.top - 44,
        left: rect.left + rect.width / 2,
        transform: "translateX(-50%)",
        zIndex: 50,
      }}
      // Keep menu open when mouse moves onto it
      onMouseEnter={() => {
        if (!tableRef.current) return;
        const r = tableRef.current.getBoundingClientRect();
        setRect({ top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width });
      }}
      onMouseLeave={() => {
        tableRef.current = null;
        setRect(null);
      }}
      className="flex items-center gap-0.5 rounded-lg border bg-background p-1 shadow-lg"
    >
      <button type="button" title="Add row above"
        onClick={() => editor.chain().focus().addRowBefore().run()}
        className="rounded p-1.5 text-sm hover:bg-accent">
        <ArrowUpToLine className="h-4 w-4" />
      </button>
      <button type="button" title="Add row below"
        onClick={() => editor.chain().focus().addRowAfter().run()}
        className="rounded p-1.5 text-sm hover:bg-accent">
        <ArrowDownToLine className="h-4 w-4" />
      </button>
      <button type="button" title="Add column left"
        onClick={() => editor.chain().focus().addColumnBefore().run()}
        className="rounded p-1.5 text-sm hover:bg-accent">
        <ArrowLeftToLine className="h-4 w-4" />
      </button>
      <button type="button" title="Add column right"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        className="rounded p-1.5 text-sm hover:bg-accent">
        <ArrowRightToLine className="h-4 w-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <button type="button" title="Delete row"
        onClick={() => editor.chain().focus().deleteRow().run()}
        className="flex items-center rounded p-1.5 text-sm text-destructive hover:bg-destructive/10">
        <span className="mr-0.5 text-xs font-medium">−</span>
        <Rows3 className="h-4 w-4" />
      </button>
      <button type="button" title="Delete column"
        onClick={() => editor.chain().focus().deleteColumn().run()}
        className="flex items-center rounded p-1.5 text-sm text-destructive hover:bg-destructive/10">
        <span className="mr-0.5 text-xs font-medium">−</span>
        <Columns3 className="h-4 w-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <button type="button" title="Delete table"
        onClick={() => editor.chain().focus().deleteTable().run()}
        className="rounded p-1.5 text-sm text-destructive hover:bg-destructive/10">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );

  return createPortal(toolbar, document.body);
}
