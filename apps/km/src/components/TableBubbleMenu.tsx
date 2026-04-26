"use client";

import { BubbleMenu, type TiptapEditor } from "@episteme/editor";
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

export function TableBubbleMenu({ editor }: { editor: TiptapEditor }) {
  const [isHoveringTable, setIsHoveringTable] = useState(false);
  const hoveredTableRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;

    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const tableEl = target?.closest?.("table") as HTMLElement | null;
      if (tableEl && dom.contains(tableEl)) {
        hoveredTableRef.current = tableEl;
        setIsHoveringTable(true);
      }
    };

    const onMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      // Only clear if the mouse left the table entirely (not just moved between cells)
      if (
        hoveredTableRef.current &&
        !hoveredTableRef.current.contains(related)
      ) {
        hoveredTableRef.current = null;
        setIsHoveringTable(false);
      }
    };

    dom.addEventListener("mouseover", onMouseOver);
    dom.addEventListener("mouseout", onMouseOut);
    return () => {
      dom.removeEventListener("mouseover", onMouseOver);
      dom.removeEventListener("mouseout", onMouseOut);
    };
  }, [editor]);

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={() => isHoveringTable}
      tippyOptions={{
        placement: "top",
        interactive: true,
        getReferenceClientRect: () => {
          const el = hoveredTableRef.current;
          if (el) return el.getBoundingClientRect();
          return editor.view.dom.getBoundingClientRect();
        },
        popperOptions: {
          strategy: "fixed",
          modifiers: [
            { name: "flip", enabled: true },
            { name: "preventOverflow", enabled: true },
          ],
        },
      }}
      className="flex items-center gap-0.5 rounded-lg border bg-background p-1 shadow-lg"
    >
      <button
        type="button"
        title="Add row above"
        onClick={() => editor.chain().focus().addRowBefore().run()}
        className="rounded p-1.5 text-sm hover:bg-accent"
      >
        <ArrowUpToLine className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Add row below"
        onClick={() => editor.chain().focus().addRowAfter().run()}
        className="rounded p-1.5 text-sm hover:bg-accent"
      >
        <ArrowDownToLine className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Add column left"
        onClick={() => editor.chain().focus().addColumnBefore().run()}
        className="rounded p-1.5 text-sm hover:bg-accent"
      >
        <ArrowLeftToLine className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Add column right"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        className="rounded p-1.5 text-sm hover:bg-accent"
      >
        <ArrowRightToLine className="h-4 w-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <button
        type="button"
        title="Delete row"
        onClick={() => editor.chain().focus().deleteRow().run()}
        className="flex items-center rounded p-1.5 text-sm text-destructive hover:bg-destructive/10"
      >
        <span className="mr-0.5 text-xs font-medium">−</span>
        <Rows3 className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Delete column"
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
        onClick={() => editor.chain().focus().deleteTable().run()}
        className="rounded p-1.5 text-sm text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </BubbleMenu>
  );
}
