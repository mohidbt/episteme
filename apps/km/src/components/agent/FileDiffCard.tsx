"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface FileDiffCardProps {
  noteId: string;
  beforeHash: string;
  afterHash: string;
  diff: string;
}

/**
 * Episteme-specific transcript card emitted by `file_diff` SSE event.
 * Renders the unified diff string from the event payload (the typed event
 * carries `diff` text only — `DiffView` requires before/after content, not
 * a unified-diff string, so we render the diff inline as preformatted text).
 */
export function FileDiffCard({
  noteId,
  beforeHash,
  afterHash,
  diff,
}: FileDiffCardProps) {
  return (
    <Card data-testid="card-file_diff" className="py-2">
      <CardHeader className="px-3 pt-2 pb-1">
        <div className="text-xs text-muted-foreground">
          Note <span className="font-mono">{noteId.slice(0, 8)}…</span> · before{" "}
          <span className="font-mono">{beforeHash.slice(0, 7)}</span> → after{" "}
          <span className="font-mono">{afterHash.slice(0, 7)}</span>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-2 space-y-2">
        <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed font-mono rounded-md border border-border bg-muted/30 p-2 max-h-72 overflow-auto">
          {diff}
        </pre>
        <div className="flex gap-2">
          <Link
            href={`/n/${noteId}`}
            data-action="open-in-editor"
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
          >
            Open in editor
          </Link>
          <Button
            size="sm"
            variant="outline"
            data-action="revert"
            onClick={() => {
              /* TODO: revert flow */
            }}
          >
            Revert
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-action="view-full"
            onClick={() => {
              /* TODO: full diff modal */
            }}
          >
            View full
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
