"use client";

import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { normalizeLinkHref } from "@/lib/normalize-link-href";

export interface LinkPopoverProps {
  /** Reserved for parent state machines — component itself always renders. */
  open?: boolean;
  initialText: string;
  initialHref: string;
  onSave: (next: { text: string; href: string }) => void;
  onCancel: () => void;
  /** When provided, renders a Remove button and uses "Save" instead of "Insert". */
  onRemove?: () => void;
}

export function LinkPopover({
  initialText,
  initialHref,
  onSave,
  onCancel,
  onRemove,
}: LinkPopoverProps) {
  const [text, setText] = useState(initialText);
  const [href, setHref] = useState(initialHref);
  const isEdit = onRemove != null;
  const primaryLabel = isEdit ? "Save" : "Insert";

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!href.trim()) return;
    // Normalize a bare hostname (`google.com`) to `https://google.com` so it
    // isn't persisted as a link relative to the current editor route (GSD-224).
    const normalizedHref = normalizeLinkHref(href);
    onSave({ text: text.trim() || normalizedHref, href: normalizedHref });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-lg border bg-popover p-3 shadow-md"
      style={{ minWidth: 280 }}
    >
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Display text
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Link text"
          aria-label="Display text"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        URL
        <Input
          value={href}
          onChange={(e) => setHref(e.target.value)}
          placeholder="https://"
          aria-label="URL"
          autoFocus={isEdit ? false : true}
        />
      </label>
      <div className="mt-1 flex items-center justify-end gap-2">
        {isEdit && (
          <Button type="button" variant="destructive" size="sm" onClick={onRemove}>
            Remove
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          {primaryLabel}
        </Button>
      </div>
    </form>
  );
}
