"use client";

import { BubbleMenu, type TiptapEditor } from "@episteme/editor";
import { useState, useCallback } from "react";
import { Pencil } from "lucide-react";
import { LinkPopover } from "@/components/LinkPopover";

/**
 * GSD-29 (c) — when the caret is inside an existing link, show a small
 * edit-icon bubble. Clicking the icon opens the LinkPopover pre-filled with
 * the current link's text + href. Save overwrites the mark; Remove unlinks.
 *
 * shouldShow runs on every selection change; we only render when the cursor
 * sits inside a `link` mark AND the AiBubbleMenu's selection-range case is
 * not active (handled implicitly: AiBubbleMenu only shows on non-empty
 * selection; the link mark can be detected at a collapsed caret too).
 */
export function LinkBubbleMenu({ editor }: { editor: TiptapEditor }) {
  const [editing, setEditing] = useState(false);
  const [initial, setInitial] = useState({ text: "", href: "" });
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);

  const openEdit = useCallback(() => {
    const { from, $from } = editor.state.selection;
    // Walk outward to find the link mark's bounds at the current position.
    const linkMark = $from.marks().find((m) => m.type.name === "link");
    if (!linkMark) return;
    // Expand selection to cover the entire link mark.
    let start = from;
    let end = from;
    const parentText = $from.parent;
    const parentStart = from - $from.parentOffset;
    parentText.descendants((node, offset) => {
      if (!node.isText) return;
      if (!node.marks.some((m) => m.eq(linkMark))) return;
      const nodeStart = parentStart + offset;
      const nodeEnd = nodeStart + node.nodeSize;
      if (nodeEnd >= from && nodeStart <= from) {
        start = Math.min(start, nodeStart);
        end = Math.max(end, nodeEnd);
      }
    });
    const text = editor.state.doc.textBetween(start, end, "");
    const href = String(linkMark.attrs.href ?? "");
    setRange({ from: start, to: end });
    setInitial({ text, href });
    setEditing(true);
  }, [editor]);

  const close = useCallback(() => {
    setEditing(false);
    setRange(null);
  }, []);

  const save = useCallback(
    ({ text, href }: { text: string; href: string }) => {
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
      close();
    },
    [editor, range, close],
  );

  const remove = useCallback(() => {
    if (!range) return;
    editor.chain().focus().setTextSelection(range).unsetMark("link").run();
    close();
  }, [editor, range, close]);

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: ed, state }) => {
        if (editing) return true;
        if (!ed.isActive("link")) return false;
        // Defer to AiBubbleMenu when there's a non-collapsed selection.
        const { from, to } = state.selection;
        return from === to;
      }}
      tippyOptions={{
        placement: "top",
        interactive: true,
      }}
      className="flex items-center gap-1 rounded-lg border bg-background p-1 shadow-lg"
    >
      {editing ? (
        <LinkPopover
          initialText={initial.text}
          initialHref={initial.href}
          onSave={save}
          onCancel={close}
          onRemove={remove}
        />
      ) : (
        <button
          type="button"
          onClick={openEdit}
          aria-label="Edit link"
          className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>
      )}
    </BubbleMenu>
  );
}
