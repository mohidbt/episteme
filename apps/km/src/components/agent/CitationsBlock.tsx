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
  InlineCitationCardTrigger,
} from "@/components/ai-elements/inline-citation";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";

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
                onClick={() => onCitationClick(citation)}
              />
            </InlineCitationCard>
          </InlineCitation>
        );
      })}
    </div>
  );
}

export interface AllSourcesListProps {
  citations: Citation[];
  /** Render rows expanded by default — used by tests; the user-facing
   * AgentTranscript leaves this unset so the sidebar opens on click. */
  defaultOpen?: boolean;
}

export function AllSourcesList({ citations, defaultOpen }: AllSourcesListProps) {
  if (citations.length === 0) return null;
  return (
    <div data-testid="all-citations">
      <Sources {...({ defaultOpen } as Record<string, unknown>)}>
        <SourcesTrigger count={citations.length}>
          <p className="font-medium">Sources ({citations.length})</p>
        </SourcesTrigger>
        <SourcesContent>
          {citations.map((c, i) => {
            const chunkId = chunkIdOf(c, i);
            const label =
              c.title ??
              `${c.chunk_id ?? c.chunkId ?? chunkId}${c.page ? ` · p${c.page}` : ""}`;
            return (
              <Source
                key={`${chunkId}-${i}`}
                href={c.url ?? "#"}
                title={label}
              >
                <span className="block font-medium">{label}</span>
              </Source>
            );
          })}
        </SourcesContent>
      </Sources>
    </div>
  );
}
