"use client";

// GSD-100 - inline pill rendered for `[[pdf:UUID#pN]]` anchors emitted
// by the deep-read agent skill. Mirrors the citation-pill styling but
// stays inline with prose (sized down, anchored to the surrounding line
// height) so the assistant text reads naturally.
//
// Click flow reuses the existing citation-click handler in
// `AgentTranscript` (which decides reader-jump-in-place vs router push
// via `resolveCitationTarget`), so a page anchor is just a citation
// without a chunkId/bbox.

import type { Citation } from "@/lib/agent-events";

export interface PdfAnchorPillProps {
  paperId: string;
  page: number;
  onClick: (citation: Citation) => void;
}

export function PdfAnchorPill({ paperId, page, onClick }: PdfAnchorPillProps) {
  return (
    <button
      type="button"
      data-testid="pdf-anchor-pill"
      data-paper-id={paperId}
      data-page={page}
      onClick={(e) => {
        e.preventDefault();
        onClick({ paperId, paper_id: paperId, page });
      }}
      className="inline-flex items-baseline rounded-md border border-border bg-muted/40 px-1.5 py-0 text-[0.7rem] font-medium text-muted-foreground no-underline hover:bg-muted hover:text-foreground"
    >
      p {page}
    </button>
  );
}
