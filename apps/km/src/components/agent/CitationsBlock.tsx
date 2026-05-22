"use client";

/**
 * Round 2 (B1/B2/B3) — inline citation pills + "Sources (N)" sidebar.
 *
 * Two small, dumb renderers extracted from AgentTranscript so they're
 * directly testable. Pills are enumerated ([1], [2], …) and expose the
 * citation `title` via a native tooltip; the sidebar header reads
 * `Sources (N)` and each row renders the citation `title` (e.g.
 * `Paper Title - Page 4`).
 */
import type { Citation } from "@/lib/agent-events";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
} from "@/components/ai-elements/inline-citation";
function chunkIdOf(citation: Citation, idx: number): string {
  return citation.chunkId ?? citation.chunk_id ?? `citation-${idx}`;
}

export interface InlineCitationPillsProps {
  citations: Citation[];
  onCitationClick: (citation: Citation) => void;
}

export function InlineCitationPills({
  citations,
  onCitationClick,
}: InlineCitationPillsProps) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {citations.map((citation, idx) => {
        const chunkId = chunkIdOf(citation, idx);
        const label = String(idx + 1);
        return (
          <InlineCitation key={`${chunkId}-${idx}`}>
            <InlineCitationCard>
              <InlineCitationCardTrigger
                data-testid={`inline-citation-pill-${chunkId}`}
                sources={[citation.url ?? "https://example.com"]}
                label={label}
                title={citation.title}
                aria-label={
                  citation.title
                    ? `Citation ${label}: ${citation.title}`
                    : `Citation ${label}`
                }
                onClick={() => onCitationClick(citation)}
              />
              <InlineCitationCardBody className="w-[280px]">
                <div className="space-y-1 p-3">
                  {citation.title ? (
                    <p className="font-medium text-sm leading-tight">
                      {citation.title}
                    </p>
                  ) : null}
                  {citation.page ? (
                    <p className="text-muted-foreground text-xs">
                      Page {citation.page}
                    </p>
                  ) : null}
                  {citation.snippet ? (
                    <p className="line-clamp-4 text-muted-foreground text-xs leading-relaxed">
                      {citation.snippet}
                    </p>
                  ) : null}
                </div>
              </InlineCitationCardBody>
            </InlineCitationCard>
          </InlineCitation>
        );
      })}
    </div>
  );
}

